import React, { useState, useEffect } from 'react';
import Layout from '../../components/Layout';
import { useAuth } from '../../context/AuthContext';
import reportService from '../../services/reportService';
import clubService from '../../services/clubService';
import { 
  FaFileDownload, 
  FaChartBar, 
  FaHistory,
  FaCalendarAlt,
  FaBuilding,
  FaGraduationCap
} from 'react-icons/fa';
import '../../styles/Reports.css';

function ReportsPage() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState('dashboard');
  const [dashboardStats, setDashboardStats] = useState(null);
  const [auditLogs, setAuditLogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Report generation states
  const [clubActivityYear, setClubActivityYear] = useState(new Date().getFullYear());
  const [selectedClub, setSelectedClub] = useState('');
  const [naacYear, setNaacYear] = useState(new Date().getFullYear());
  const [annualYear, setAnnualYear] = useState(new Date().getFullYear());
  const [clubs, setClubs] = useState([]);

  const isAdmin = user?.roles?.global === 'admin';
  const isCoordinator = user?.roles?.global === 'coordinator';
  const isAdminOrCoordinator = isAdmin || isCoordinator;
  
  // User ID can be either user.id or user._id depending on backend response
  const userId = user?.id || user?._id;

  useEffect(() => {
    if (activeTab === 'dashboard') {
      fetchDashboardStats();
    } else if (activeTab === 'audit') {
      fetchAuditLogs();
    }
  }, [activeTab]);

  useEffect(() => {
    if (user) {
      fetchClubs();
    }
  }, [userId, isCoordinator]);

  const fetchDashboardStats = async () => {
    try {
      setLoading(true);
      const response = await reportService.getDashboard();
      // Backend returns { status, data: { dashboard: {...} } }
      setDashboardStats(response.data?.dashboard || response.data);
      setError(null);
    } catch (err) {
      console.error('Error fetching dashboard stats:', err);
      setError('Failed to load dashboard statistics');
    } finally {
      setLoading(false);
    }
  };

  const fetchAuditLogs = async () => {
    try {
      setLoading(true);
      const response = await reportService.getAuditLogs({ limit: 50, page: 1 });
      setAuditLogs(response.data.items || []);
      setError(null);
    } catch (err) {
      console.error('Error fetching audit logs:', err);
      setError('Failed to load audit logs');
    } finally {
      setLoading(false);
    }
  };

  const fetchClubs = async () => {
    try {
      const response = await clubService.listClubs();
      const allClubs = response.data?.clubs || [];
      
      // Coordinators only see clubs they coordinate
      if (isCoordinator && userId) {
        const coordinatedClubs = allClubs.filter(club => {
          const coordinatorId = typeof club.coordinator === 'object' 
            ? club.coordinator?._id 
            : club.coordinator;
          return coordinatorId === userId;
        });
        
        setClubs(coordinatedClubs);
        // Auto-select if only one club
        if (coordinatedClubs.length === 1) {
          setSelectedClub(coordinatedClubs[0]._id);
        }
      } else {
        // Admin sees all clubs
        setClubs(allClubs);
      }
    } catch (err) {
      console.error('Error fetching clubs:', err);
    }
  };

  const generateClubActivityReport = async () => {
    if (!selectedClub) {
      alert('Please select a club');
      return;
    }

    try {
      setLoading(true);
      const response = await reportService.generateClubActivityReport(selectedClub, clubActivityYear);

      // Download the file using helper
      reportService.downloadBlob(response.data, `club-activity-${clubActivityYear}.pdf`);
      
      alert('Report generated successfully!');
    } catch (err) {
      console.error('Error generating report:', err);
      alert('Failed to generate report');
    } finally {
      setLoading(false);
    }
  };

  const generateNAACReport = async () => {
    try {
      setLoading(true);
      const response = await reportService.generateNAACReport(naacYear);

      reportService.downloadBlob(response.data, `NAAC-Report-${naacYear}.pdf`);
      
      alert('NAAC Report generated successfully!');
    } catch (err) {
      console.error('Error generating NAAC report:', err);
      alert('Failed to generate NAAC report');
    } finally {
      setLoading(false);
    }
  };

  const generateAnnualReport = async () => {
    try {
      setLoading(true);
      const response = await reportService.generateAnnualReport(annualYear);

      reportService.downloadBlob(response.data, `Annual-Report-${annualYear}.pdf`);
      
      alert('Annual Report generated successfully!');
    } catch (err) {
      console.error('Error generating annual report:', err);
      alert('Failed to generate annual report');
    } finally {
      setLoading(false);
    }
  };

  const downloadClubActivityCSV = async () => {
    if (!selectedClub) {
      alert('Please select a club');
      return;
    }

    try {
      setLoading(true);
      console.log('📥 Exporting Club Activity CSV via export route:', { clubId: selectedClub, year: clubActivityYear });

      // Use the dedicated export route for parity with Club Dashboard
      const response = await reportService.exportClubActivityCSV(selectedClub, clubActivityYear);

      console.log('📄 CSV Response received:', {
        type: response.data.type,
        size: response.data.size
      });

      reportService.downloadBlob(response.data, `club-activity-${clubActivityYear}.csv`);
      alert('✅ CSV report downloaded successfully!');
    } catch (err) {
      console.error('❌ Error downloading CSV:', err);
      const errorMsg = err.response?.data?.message || err.message || 'Failed to download CSV report';
      alert(`Failed to download CSV: ${errorMsg}`);
    } finally {
      setLoading(false);
    }
  };

  if (!isAdminOrCoordinator) {
    return (
      <Layout>
        <div className="unauthorized">
          <h2>Access Denied</h2>
          <p>You don't have permission to view reports.</p>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="reports-page">
        <div className="reports-header">
          <h1><FaChartBar /> Reports & Analytics</h1>
          <p>Generate reports and view system analytics</p>
        </div>

        <div className="reports-tabs">
          <button
            className={`tab-btn ${activeTab === 'dashboard' ? 'active' : ''}`}
            onClick={() => setActiveTab('dashboard')}
          >
            <FaChartBar /> Dashboard
          </button>
          <button
            className={`tab-btn ${activeTab === 'generate' ? 'active' : ''}`}
            onClick={() => setActiveTab('generate')}
          >
            <FaFileDownload /> Generate Reports
          </button>
          {/* Audit Logs - Admin Only */}
          {isAdmin && (
            <button
              className={`tab-btn ${activeTab === 'audit' ? 'active' : ''}`}
              onClick={() => setActiveTab('audit')}
            >
              <FaHistory /> Audit Logs
            </button>
          )}
        </div>

        {error && <div className="error-message">{error}</div>}

        {/* Dashboard Tab */}
        {activeTab === 'dashboard' && (
          <div className="dashboard-stats">
            {loading ? (
              <div className="loading">Loading statistics...</div>
            ) : dashboardStats ? (
              <>
                <div className="stats-grid">
                  <div className="stat-card">
                    <div className="stat-icon">
                      <FaBuilding />
                    </div>
                    <div className="stat-content">
                      <h3>{dashboardStats.totalClubs || 0}</h3>
                      <p>Total Clubs</p>
                    </div>
                  </div>

                  <div className="stat-card">
                    <div className="stat-icon">
                      <FaGraduationCap />
                    </div>
                    <div className="stat-content">
                      <h3>{dashboardStats.totalStudents || 0}</h3>
                      <p>Total Students</p>
                    </div>
                  </div>

                  <div className="stat-card">
                    <div className="stat-icon">
                      <FaCalendarAlt />
                    </div>
                    <div className="stat-content">
                      <h3>{dashboardStats.totalEvents || 0}</h3>
                      <p>Total Events</p>
                    </div>
                  </div>

                  <div className="stat-card">
                    <div className="stat-icon">
                      <FaChartBar />
                    </div>
                    <div className="stat-content">
                      <h3>{dashboardStats.activeRecruitments || 0}</h3>
                      <p>Active Recruitments</p>
                    </div>
                  </div>
                </div>

                <div className="recent-activity">
                  <h2>Recent Activity Overview</h2>
                  <div className="activity-summary">
                    <div className="summary-item">
                      <strong>Pending Approvals:</strong>
                      <span>{dashboardStats.pendingApprovals || 0}</span>
                    </div>
                    <div className="summary-item">
                      <strong>Events This Month:</strong>
                      <span>{dashboardStats.eventsThisMonth || 0}</span>
                    </div>
                    <div className="summary-item">
                      <strong>New Members This Month:</strong>
                      <span>{dashboardStats.newMembersThisMonth || 0}</span>
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <div className="empty-state">No dashboard data available</div>
            )}
          </div>
        )}

        {/* Generate Reports Tab */}
        {activeTab === 'generate' && (
          <div className="generate-reports">
            <div className="report-section">
              <h2>Club Activity Report</h2>
              <p>Generate detailed activity report for a specific club and year</p>
              {isCoordinator && clubs.length > 0 && (
                <div className="info-message">
                  <strong>Note:</strong> You can only generate reports for clubs you coordinate: <strong>{clubs.map(c => c.name).join(', ')}</strong>
                </div>
              )}
              {isCoordinator && clubs.length === 0 && (
                <div className="warning-message">
                  <strong>Warning:</strong> You are not assigned as coordinator to any club. Please contact admin.
                </div>
              )}
              <div className="report-form">
                <div className="form-group">
                  <label>Select Club</label>
                  <select
                    value={selectedClub}
                    onChange={(e) => setSelectedClub(e.target.value)}
                  >
                    <option value="">-- Select Club --</option>
                    {clubs.map(club => (
                      <option key={club._id} value={club._id}>
                        {club.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label>Year</label>
                  <input
                    type="number"
                    value={clubActivityYear}
                    onChange={(e) => setClubActivityYear(e.target.value)}
                    min="2020"
                    max={new Date().getFullYear()}
                  />
                </div>
                <button
                  className="btn btn-primary"
                  onClick={generateClubActivityReport}
                  disabled={loading || !selectedClub}
                >
                  <FaFileDownload /> Generate PDF
                </button>
                <button
                  className="btn btn-secondary"
                  onClick={downloadClubActivityCSV}
                  disabled={loading || !selectedClub}
                >
                  <FaFileDownload /> Download CSV
                </button>
              </div>
            </div>

            {user?.roles?.global === 'admin' && (
              <>
                <div className="report-section">
                  <h2>NAAC/NBA Report</h2>
                  <p>Generate compliance report for accreditation</p>
                  <div className="report-form">
                    <div className="form-group">
                      <label>Academic Year</label>
                      <input
                        type="number"
                        value={naacYear}
                        onChange={(e) => setNaacYear(e.target.value)}
                        min="2020"
                        max={new Date().getFullYear()}
                      />
                    </div>
                    <button
                      className="btn btn-primary"
                      onClick={generateNAACReport}
                      disabled={loading}
                    >
                      <FaFileDownload /> Generate NAAC Report
                    </button>
                  </div>
                </div>

                <div className="report-section">
                  <h2>Annual Report</h2>
                  <p>Generate comprehensive annual report for the institution</p>
                  <div className="report-form">
                    <div className="form-group">
                      <label>Year</label>
                      <input
                        type="number"
                        value={annualYear}
                        onChange={(e) => setAnnualYear(e.target.value)}
                        min="2020"
                        max={new Date().getFullYear()}
                      />
                    </div>
                    <button
                      className="btn btn-primary"
                      onClick={generateAnnualReport}
                      disabled={loading}
                    >
                      <FaFileDownload /> Generate Annual Report
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* Audit Logs Tab */}
        {activeTab === 'audit' && (
          <div className="audit-logs">
            <h2>System Audit Logs</h2>
            {loading ? (
              <div className="loading">Loading audit logs...</div>
            ) : auditLogs.length > 0 ? (
              <div className="audit-table-container">
                <table className="audit-table">
                  <thead>
                    <tr>
                      <th>Timestamp</th>
                      <th>User</th>
                      <th>Action</th>
                      <th>Target</th>
                      <th>IP Address</th>
                    </tr>
                  </thead>
                  <tbody>
                    {auditLogs.map((log) => (
                      <tr key={log._id}>
                        <td>{new Date(log.createdAt).toLocaleString()}</td>
                        <td>{log.user?.profile?.name || log.user?.email || 'System'}</td>
                        <td><span className="action-badge">{log.action}</span></td>
                        <td>{log.target}</td>
                        <td>{log.ip || 'N/A'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="empty-state">No audit logs available</div>
            )}
          </div>
        )}
      </div>
    </Layout>
  );
}

export default ReportsPage;
