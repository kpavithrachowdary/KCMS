const mongoose = require('mongoose');
const { Club } = require('../club/club.model');
const { Membership } = require('../club/membership.model');
const { Event } = require('../event/event.model');
const { Recruitment } = require('../recruitment/recruitment.model');
const { BudgetRequest } = require('../event/budgetRequest.model');
const { AuditLog } = require('../audit/auditLog.model');
const { Attendance } = require('../event/attendance.model');
const reportGenerator = require('../../utils/reportGenerator');
const naacService = require('./naac.service');

class ReportService {
  async dashboard() {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    
    // Get total counts
    const totalClubs = await Club.countDocuments({ status: 'active' });
    const totalStudents = await Membership.countDocuments({ status: 'approved' });
    const totalEvents = await Event.countDocuments(); // All events ever created
    
    // Get this month's stats
    const eventsThisMonth = await Event.countDocuments({
      dateTime: { $gte: monthStart, $lte: now }
    });
    
    const newMembersThisMonth = await Membership.countDocuments({
      joinedAt: { $gte: monthStart, $lte: now },
      status: 'approved'
    });
    
    // Get pending approvals
    const pendingClubs = await Club.countDocuments({ status: 'pending_approval' });
    const pendingEvents = await Event.countDocuments({ 
      status: { $in: ['pending_coordinator', 'pending_admin'] }
    });
    const pendingApprovals = pendingClubs + pendingEvents;
    
    // Get active recruitments (scheduled or in_progress)
    const activeRecruitments = await Recruitment.countDocuments({
      status: { $in: ['scheduled', 'in_progress'] }
    });
    
    // Get recruitment summary (for detailed stats if needed)
    const recruitmentStatuses = await Recruitment.aggregate([
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ]);
    const recruitmentSummary = {};
    recruitmentStatuses.forEach(r => recruitmentSummary[r._id] = r.count);

    return {
      // Field names matching frontend expectations
      totalClubs,
      totalStudents,
      totalEvents,
      activeRecruitments,
      eventsThisMonth,
      newMembersThisMonth,
      pendingApprovals,
      
      // Additional detailed info
      pendingClubs,
      pendingEvents,
      recruitmentSummary
    };
  }

  async clubActivity({ clubId, year }) {
    const start = new Date(year, 0, 1), end = new Date(year+1, 0, 1);
    const eventsCount = await Event.countDocuments({
      club: clubId,
      dateTime: { $gte: start, $lt: end }
    });
    const membersCount = await Membership.countDocuments({
      club: clubId,
      status: 'approved'
    });
    const budgets = await BudgetRequest.aggregate([
      { $match: { event: { $in: await Event.find({ club: clubId }).distinct('_id') } } },
      { $group: { _id: null, totalRequested: { $sum: '$amount' } } }
    ]);
    const recs = await Recruitment.countDocuments({ club: clubId, startDate: { $gte: start, $lt: end } });
    const apps = await mongoose.model('Application').countDocuments({
      recruitment: { $in: await Recruitment.find({ club: clubId }).distinct('_id') }
    });

    return {
      eventsCount,
      membersCount,
      totalBudgetRequested: budgets[0]?.totalRequested || 0,
      recruitmentCycles: recs,
      applications: apps
    };
  }

  async naacNba({ year }) {
    // similar to dashboard + clubActivity for all clubs
    const dash = await this.dashboard();
    const annual = await this.annual({ year });
    // attach evidence: count of docs & media uploaded that year
    const docsCount = await mongoose.model('Document').countDocuments({
      createdAt: { $gte: new Date(year,0,1), $lt: new Date(year+1,0,1) }
    });
    return { dash, annual, docsCount };
  }

  async annual({ year }) {
    const start = new Date(year,0,1), end = new Date(year+1,0,1);
    const clubs = await Club.countDocuments({ createdAt: { $gte: start, $lt: end } });
    const events = await Event.countDocuments({ createdAt: { $gte: start, $lt: end } });
    const members = await Membership.countDocuments({ createdAt: { $gte: start, $lt: end } });
    return { clubs, events, members };
  }

  async listAudit({ user, action, from, to, page=1, limit=20 }) {
    const query = {};
    if (user)   query.user = user;
    if (action) query.action = action;
    if (from || to) query.createdAt = {};
    if (from) query.createdAt.$gte = new Date(from);
    if (to)   query.createdAt.$lte = new Date(to);

    const skip = (page-1)*limit;
    const [total, items] = await Promise.all([
      AuditLog.countDocuments(query),
      AuditLog.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
    ]);
    return { total, page, limit, items };
  }

  /**
   * Generate Club Activity Report (PDF)
   */
  async generateClubActivityReport(clubId, year, userContext) {
    const club = await Club.findById(clubId).populate('coordinator', 'profile.name');
    if (!club) {
      const err = new Error('Club not found');
      err.statusCode = 404;
      throw err;
    }

    const startDate = new Date(year, 0, 1);
    const endDate = new Date(year + 1, 0, 1);

    const [events, members, budgetRequests] = await Promise.all([
      Event.find({ 
        club: clubId, 
        dateTime: { $gte: startDate, $lt: endDate } 
      }).populate('club', 'name'),
      
      Membership.find({ 
        club: clubId, 
        status: 'approved' 
      }).populate('user', 'profile.name rollNumber'),
      
      BudgetRequest.find({
        event: { $in: await Event.find({ club: clubId }).distinct('_id') },
        createdAt: { $gte: startDate, $lt: endDate }
      }).populate('event', 'title')
    ]);

    const clubData = {
      name: club.name,
      category: club.category,
      status: club.status,
      coordinatorName: club.coordinator?.profile?.name || 'N/A'
    };

    const eventData = events.map(event => ({
      title: event.title,
      dateTime: event.dateTime,
      status: event.status,
      attendees: event.expectedAttendees || 0
    }));

    const memberData = {
      totalMembers: members.length
    };

    const budgetData = budgetRequests.map(br => ({
      title: br.event?.title || 'Unknown Event',
      amount: br.amount,
      status: br.status
    }));

    // Generate PDF buffer directly instead of uploading
    return await reportGenerator.generateClubActivityReport(
      clubData,
      eventData,
      memberData,
      budgetData
    );
  }

  /**
   * Generate Club Activity Report as Excel
   */
  async generateClubActivityExcel({ clubId, year }) {
    const club = await Club.findById(clubId).populate('coordinator', 'profile.name');
    if (!club) {
      const err = new Error('Club not found');
      err.statusCode = 404;
      throw err;
    }

    const startDate = new Date(year, 0, 1);
    const endDate = new Date(year + 1, 0, 1);

    const [events, members, budgetRequests] = await Promise.all([
      Event.find({ 
        club: clubId, 
        dateTime: { $gte: startDate, $lt: endDate } 
      }).lean(),
      
      Membership.find({ 
        club: clubId, 
        status: 'approved' 
      }).populate('user', 'profile.name rollNumber').lean(),
      
      BudgetRequest.find({
        event: { $in: await Event.find({ club: clubId }).distinct('_id') },
        createdAt: { $gte: startDate, $lt: endDate }
      }).populate('event', 'title').lean()
    ]);

    // Generate Excel using ExcelJS
    const ExcelJS = require('exceljs');
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Club Activity Report');

    // === SUMMARY SECTION ===
    worksheet.mergeCells('A1:F1');
    worksheet.getCell('A1').value = `${club.name} - Activity Report ${year}`;
    worksheet.getCell('A1').font = { size: 16, bold: true };
    worksheet.getCell('A1').alignment = { horizontal: 'center' };
    worksheet.addRow([]);

    // Club Summary
    worksheet.addRow(['Club Information']);
    worksheet.getRow(3).font = { bold: true, size: 12 };
    worksheet.addRow(['Club Name', club.name]);
    worksheet.addRow(['Category', club.category]);
    worksheet.addRow(['Coordinator', club.coordinator?.profile?.name || 'N/A']);
    worksheet.addRow(['Total Members', members.length]);
    worksheet.addRow(['Total Events', events.length]);
    worksheet.addRow(['Total Budget', `₹${budgetRequests.reduce((sum, br) => sum + (br.amount || 0), 0)}`]);
    worksheet.addRow([]);

    // === EVENTS SECTION ===
    worksheet.addRow(['Events List']);
    worksheet.getRow(worksheet.lastRow.number).font = { bold: true, size: 12 };
    
    // Events header
    const eventsHeaderRow = worksheet.addRow(['Event Title', 'Date', 'Status', 'Attendees', 'Budget']);
    eventsHeaderRow.font = { bold: true };
    eventsHeaderRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0E0' }
    };

    // Events data
    events.forEach(event => {
      worksheet.addRow([
        event.title,
        new Date(event.dateTime).toLocaleDateString(),
        event.status,
        event.expectedAttendees || 0,
        event.budget ? `₹${event.budget}` : 'N/A'
      ]);
    });

    worksheet.addRow([]);

    // === BUDGET SECTION ===
    if (budgetRequests.length > 0) {
      worksheet.addRow(['Budget Requests']);
      worksheet.getRow(worksheet.lastRow.number).font = { bold: true, size: 12 };
      
      const budgetHeaderRow = worksheet.addRow(['Event', 'Amount', 'Status']);
      budgetHeaderRow.font = { bold: true };
      budgetHeaderRow.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFE0E0E0' }
      };

      budgetRequests.forEach(br => {
        worksheet.addRow([
          br.event?.title || 'Unknown Event',
          `₹${br.amount}`,
          br.status
        ]);
      });
    }

    // Set column widths
    worksheet.getColumn(1).width = 30;
    worksheet.getColumn(2).width = 15;
    worksheet.getColumn(3).width = 15;
    worksheet.getColumn(4).width = 15;
    worksheet.getColumn(5).width = 15;

    return await workbook.xlsx.writeBuffer();
  }

  /**
   * Generate NAAC/NBA Report (Enhanced PDF with proper formatting)
   */
  async generateNAACReport(year, userContext) {
    // Use the enhanced NAAC service
    return await naacService.generateNAACReport(year, userContext);
  }

  /**
   * Generate Annual Report (PDF)
   */
  async generateAnnualReport(year, userContext) {
    const startDate = new Date(year, 0, 1);
    const endDate = new Date(year + 1, 0, 1);

    const [
      clubsCount,
      eventsCount,
      membersCount,
      totalBudget,
      clubs,
      events
    ] = await Promise.all([
      Club.countDocuments({ createdAt: { $gte: startDate, $lt: endDate } }),
      Event.countDocuments({ dateTime: { $gte: startDate, $lt: endDate } }),
      Membership.countDocuments({ createdAt: { $gte: startDate, $lt: endDate } }),
      Event.aggregate([
        { $match: { dateTime: { $gte: startDate, $lt: endDate } } },
        { $group: { _id: null, total: { $sum: '$budget' } } }
      ]),
      Club.find({ status: 'active' }).limit(10),
      Event.find({ 
        dateTime: { $gte: startDate, $lt: endDate },
        status: 'completed'
      }).populate('club', 'name').sort({ expectedAttendees: -1 }).limit(10)
    ]);

    const summaryData = {
      totalClubs: clubsCount,
      totalEvents: eventsCount,
      totalMembers: membersCount,
      totalBudget: totalBudget[0]?.total || 0
    };

    const topClubs = await Promise.all(clubs.map(async club => {
      const [eventsCount, memberCount] = await Promise.all([
        Event.countDocuments({ 
          club: club._id, 
          dateTime: { $gte: startDate, $lt: endDate } 
        }),
        Membership.countDocuments({ 
          club: club._id, 
          status: 'approved' 
        })
      ]);
      return {
        name: club.name,
        eventsCount,
        memberCount
      };
    }));

    const topEvents = events.map(event => ({
      title: event.title,
      clubName: event.club.name,
      dateTime: event.dateTime,
      attendees: event.expectedAttendees || 0
    }));

    // Generate PDF buffer directly instead of uploading
    return await reportGenerator.generateAnnualReport(
      year,
      summaryData,
      topClubs,
      topEvents
    );
  }

  /**
   * Generate Attendance Report (Excel)
   */
  async generateAttendanceReport(eventId, userContext) {
    const event = await Event.findById(eventId).populate('club', 'name');
    if (!event) {
      const err = new Error('Event not found');
      err.statusCode = 404;
      throw err;
    }

    const attendance = await Attendance.find({ event: eventId })
      .populate('user', 'profile.name rollNumber email')
      .sort({ timestamp: -1 });

    const attendanceData = attendance.map(att => ({
      rollNumber: att.user.rollNumber,
      name: att.user.profile.name,
      email: att.user.email,
      status: att.status,
      timestamp: att.timestamp
    }));

    const eventInfo = {
      title: event.title,
      venue: event.venue,
      clubName: event.club.name
    };

    // Generate Excel buffer directly instead of uploading
    return await reportGenerator.generateAttendanceReport(
      attendanceData,
      eventInfo
    );
  }

  /**
   * Generate CSV from data array
   * Workplan Line 474: CSV export format
   */
  generateCSV(data, headers = null) {
    if (!data || data.length === 0) {
      throw new Error('No data to export to CSV');
    }
    
    // If headers not provided, extract from first object
    const csvHeaders = headers || Object.keys(data[0]);
    
    // Create CSV rows
    const csvRows = [];
    
    // Add header row
    csvRows.push(csvHeaders.join(','));
    
    // Add data rows
    for (const row of data) {
      const values = csvHeaders.map(header => {
        const value = row[header];
        
        // Handle different data types
        if (value === null || value === undefined) {
          return '';
        }
        
        // Handle dates
        if (value instanceof Date) {
          return value.toLocaleDateString();
        }
        
        // Escape quotes and wrap in quotes if contains comma/quote/newline
        const escaped = String(value).replace(/"/g, '""');
        return escaped.includes(',') || escaped.includes('"') || escaped.includes('\n')
          ? `"${escaped}"`
          : escaped;
      });
      
      csvRows.push(values.join(','));
    }
    
    return csvRows.join('\n');
  }

  /**
   * Generate Club Activity Report as CSV (comprehensive version)
   */
  async generateClubActivityCSV({ clubId, year }) {
    const club = await Club.findById(clubId).populate('coordinator', 'profile.name');
    if (!club) {
      const err = new Error('Club not found');
      err.statusCode = 404;
      throw err;
    }

    // Parse year as integer
    const parsedYear = parseInt(year) || new Date().getFullYear();
    console.log('📅 Generating CSV for year:', parsedYear);

    const startDate = new Date(parsedYear, 0, 1);
    const endDate = new Date(parsedYear + 1, 0, 1);

    const [events, members, budgetRequests] = await Promise.all([
      Event.find({ 
        club: clubId, 
        dateTime: { $gte: startDate, $lt: endDate } 
      }).lean(),
      
      Membership.find({ 
        club: clubId, 
        status: 'approved' 
      }).populate('user', 'profile.name rollNumber').lean(),
      
      BudgetRequest.find({
        event: { $in: await Event.find({ club: clubId }).distinct('_id') },
        createdAt: { $gte: startDate, $lt: endDate }
      }).populate('event', 'title').lean()
    ]);

    // Build CSV manually for proper formatting
    const csvRows = [];
    
    // Helper function to escape CSV values
    const escapeCSV = (value) => {
      if (value === null || value === undefined) return '';
      const str = String(value);
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    // Club Information Section
    csvRows.push(`${club.name} - Activity Report ${parsedYear}`);
    csvRows.push('');
    csvRows.push('Club Information');
    csvRows.push(`Club Name,${escapeCSV(club.name)}`);
    csvRows.push(`Category,${escapeCSV(club.category)}`);
    csvRows.push(`Coordinator,${escapeCSV(club.coordinator?.profile?.name || 'N/A')}`);
    csvRows.push(`Total Members,${members.length}`);
    csvRows.push(`Total Events,${events.length}`);
    csvRows.push(`Total Budget,₹${budgetRequests.reduce((sum, br) => sum + (br.amount || 0), 0)}`);
    csvRows.push('');
    
    // Events Section
    csvRows.push('Events List');
    csvRows.push('Event Title,Date,Status,Venue,Expected Attendees,Budget');
    
    events.forEach(event => {
      csvRows.push([
        escapeCSV(event.title),
        escapeCSV(new Date(event.dateTime).toLocaleDateString()),
        escapeCSV(event.status),
        escapeCSV(event.venue || 'N/A'),
        event.expectedAttendees || 0,
        event.budget ? `₹${event.budget}` : 'N/A'
      ].join(','));
    });
    
    if (events.length === 0) {
      csvRows.push('No events found for this period');
    }
    
    csvRows.push('');
    
    // Budget Requests Section
    if (budgetRequests.length > 0) {
      csvRows.push('Budget Requests');
      csvRows.push('Event,Amount,Status');
      
      budgetRequests.forEach(br => {
        csvRows.push([
          escapeCSV(br.event?.title || 'Unknown Event'),
          `₹${br.amount}`,
          escapeCSV(br.status)
        ].join(','));
      });
    }
    
    csvRows.push('');
    csvRows.push(`Report Generated: ${new Date().toLocaleString()}`);
    
    return csvRows.join('\n');
  }

  /**
   * Export Club Activity Report as CSV (simplified version)
   */
  async exportClubActivityCSV({ clubId, year }) {
    const club = await Club.findById(clubId).populate('coordinator', 'profile.name');
    if (!club) {
      const err = new Error('Club not found');
      err.statusCode = 404;
      throw err;
    }

    const startDate = new Date(year, 0, 1);
    const endDate = new Date(year + 1, 0, 1);

    const events = await Event.find({ 
      club: clubId, 
      dateTime: { $gte: startDate, $lt: endDate } 
    }).lean();

    const csvData = events.map(event => ({
      'Event Title': event.title,
      'Date': new Date(event.dateTime).toLocaleDateString(),
      'Status': event.status,
      'Venue': event.venue || 'N/A',
      'Expected Attendees': event.expectedAttendees || 0,
      'Budget': event.budget || 0
    }));

    return this.generateCSV(csvData);
  }

  /**
   * Export Audit Logs as CSV
   */
  async exportAuditLogsCSV({ user, action, from, to, limit = 1000 }) {
    const result = await this.listAudit({ user, action, from, to, page: 1, limit });
    
    const csvData = result.items.map(log => ({
      'Timestamp': new Date(log.createdAt).toLocaleString(),
      'User': log.user?.email || 'System',
      'Action': log.action,
      'Target': log.target,
      'IP Address': log.ip,
      'Status': log.status,
      'Severity': log.severity
    }));

    return this.generateCSV(csvData);
  }

  /**
   * Export Event Attendance as CSV
   */
  async exportAttendanceCSV(eventId) {
    const event = await Event.findById(eventId).populate('club', 'name');
    if (!event) {
      const err = new Error('Event not found');
      err.statusCode = 404;
      throw err;
    }

    const attendance = await Attendance.find({ event: eventId })
      .populate('user', 'profile.name rollNumber email')
      .sort({ timestamp: -1 });

    const csvData = attendance.map(att => ({
      'Roll Number': att.user.rollNumber,
      'Name': att.user.profile.name,
      'Email': att.user.email,
      'Status': att.status,
      'Timestamp': new Date(att.timestamp).toLocaleString()
    }));

    return this.generateCSV(csvData);
  }

  /**
   * Export Membership List as CSV
   */
  async exportMembersCSV(clubId) {
    const club = await Club.findById(clubId);
    if (!club) {
      const err = new Error('Club not found');
      err.statusCode = 404;
      throw err;
    }

    const members = await Membership.find({ 
      club: clubId, 
      status: 'approved' 
    })
      .populate('user', 'profile.name rollNumber email profile.department profile.year')
      .sort({ role: 1, createdAt: 1 });

    const csvData = members.map(member => ({
      'Roll Number': member.user.rollNumber,
      'Name': member.user.profile.name,
      'Email': member.user.email,
      'Department': member.user.profile.department || 'N/A',
      'Year': member.user.profile.year || 'N/A',
      'Role': member.role,
      'Joined At': new Date(member.createdAt).toLocaleDateString()
    }));

    return this.generateCSV(csvData);
  }
}

module.exports = new ReportService();