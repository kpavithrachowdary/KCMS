const svc = require('./report.service');
const { successResponse } = require('../../utils/response');

exports.dashboard = async (req, res, next) => {
  try {
    const data = await svc.dashboard();
    successResponse(res, { dashboard: data });
  } catch (err) { next(err); }
};

exports.clubActivity = async (req, res, next) => {
  try {
    const { format, ...queryParams } = req.query;
    
    console.log('📊 Club Activity Request - Full Query:', req.query);
    console.log('📊 Extracted format:', format, 'Type:', typeof format);
    console.log('📊 Query params:', queryParams);
    
    // Validate clubId is provided
    if (!queryParams.clubId) {
      const err = new Error('Club ID is required');
      err.statusCode = 400;
      throw err;
    }
    
    // If CSV format requested, generate CSV file
    if (format === 'csv') {
      console.log('✅ CSV FORMAT DETECTED - Generating CSV for club:', queryParams.clubId);
      const csvData = await svc.generateClubActivityCSV(queryParams);
      console.log('✅ CSV generated successfully, length:', csvData.length);
      console.log('✅ First 200 chars:', csvData.substring(0, 200));
      
      // Add UTF-8 BOM for proper Excel encoding
      const csvWithBOM = '\uFEFF' + csvData;
      
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="club-activity-report.csv"');
      console.log('✅ Sending CSV response...');
      return res.send(csvWithBOM);
    }
    
    console.log('⚠️  CSV format NOT detected - Returning JSON data');
    // Otherwise return JSON data
    const data = await svc.clubActivity(queryParams);
    successResponse(res, { report: data });
  } catch (err) { 
    console.error('❌ Error in clubActivity controller:', err);
    next(err); 
  }
};

exports.naacNba = async (req, res, next) => {
  try {
    const data = await svc.naacNba(req.query);
    successResponse(res, { report: data });
  } catch (err) { next(err); }
};

exports.annual = async (req, res, next) => {
  try {
    const data = await svc.annual(req.query);
    successResponse(res, { report: data });
  } catch (err) { next(err); }
};

exports.listAudit = async (req, res, next) => {
  try {
    const data = await svc.listAudit(req.query);
    successResponse(res, data);
  } catch (err) { next(err); }
};

// Generate Club Activity Report
exports.generateClubActivityReport = async (req, res, next) => {
  try {
    const pdfBuffer = await svc.generateClubActivityReport(
      req.params.clubId,
      req.params.year,
      { id: req.user.id, ip: req.ip, userAgent: req.headers['user-agent'] }
    );
    
    // Send PDF buffer directly
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="club-activity-${req.params.year}.pdf"`);
    res.send(pdfBuffer);
  } catch (err) { next(err); }
};

// Generate NAAC/NBA Report
exports.generateNAACReport = async (req, res, next) => {
  try {
    const pdfBuffer = await svc.generateNAACReport(
      req.params.year,
      { id: req.user.id, ip: req.ip, userAgent: req.headers['user-agent'] }
    );
    
    // Send PDF buffer directly
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="naac-report-${req.params.year}.pdf"`);
    res.send(pdfBuffer);
  } catch (err) { next(err); }
};

// Generate Annual Report
exports.generateAnnualReport = async (req, res, next) => {
  try {
    const pdfBuffer = await svc.generateAnnualReport(
      req.params.year,
      { id: req.user.id, ip: req.ip, userAgent: req.headers['user-agent'] }
    );
    
    // Send PDF buffer directly
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="annual-report-${req.params.year}.pdf"`);
    res.send(pdfBuffer);
  } catch (err) { next(err); }
};

// Generate Attendance Report
exports.generateAttendanceReport = async (req, res, next) => {
  try {
    const pdfBuffer = await svc.generateAttendanceReport(
      req.params.eventId,
      { id: req.user.id, ip: req.ip, userAgent: req.headers['user-agent'] }
    );
    successResponse(res, { report }, 'Attendance report generated');
  } catch (err) { next(err); }
};

// ===============================
// CSV EXPORT ENDPOINTS (Workplan Line 474)
// ===============================

/**
 * Export Club Activity Report as CSV
 */
exports.exportClubActivityCSV = async (req, res, next) => {
  try {
    const csv = await svc.exportClubActivityCSV({
      clubId: req.params.clubId,
      year: parseInt(req.params.year)
    });
    
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="club-activity-${req.params.year}.csv"`);
    res.send(csv);
  } catch (err) { next(err); }
};

/**
 * Export Audit Logs as CSV
 */
exports.exportAuditLogsCSV = async (req, res, next) => {
  try {
    const csv = await svc.exportAuditLogsCSV(req.query);
    
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="audit-logs.csv"');
    res.send(csv);
  } catch (err) { next(err); }
};

/**
 * Export Event Attendance as CSV
 */
exports.exportAttendanceCSV = async (req, res, next) => {
  try {
    const csv = await svc.exportAttendanceCSV(req.params.eventId);
    
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="attendance-${req.params.eventId}.csv"`);
    res.send(csv);
  } catch (err) { 
    next(err); 
  }
};

/**
 * Export Club Members as CSV
 */
exports.exportMembersCSV = async (req, res, next) => {
  try {
    const csv = await svc.exportMembersCSV(req.params.clubId);
    
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="members-${req.params.clubId}.csv"`);
    res.send(csv);
  } catch (err) { next(err); }
};