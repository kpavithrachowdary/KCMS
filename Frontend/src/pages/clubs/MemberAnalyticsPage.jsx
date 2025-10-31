import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import analyticsService from '../../services/analyticsService';
import clubService from '../../services/clubService';
import reportService from '../../services/reportService';
import Layout from '../../components/Layout';
import './MemberAnalyticsPage.css';

const MemberAnalyticsPage = () => {
  const { clubId } = useParams();
  const navigate = useNavigate();
  
  const [club, setClub] = useState(null);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all'); // all, active, inactive
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState('total'); // total, rate, lastActive

  useEffect(() => {
    fetchData();
  }, [clubId, filter]);

  const fetchData = async () => {
    try {
      setLoading(true);
      
      // Fetch club details
      const clubResponse = await clubService.getById(clubId);
      setClub(clubResponse.data?.data?.club || clubResponse.data?.club);
      
      // Fetch member analytics
      const analyticsResponse = await analyticsService.getMemberAnalytics(clubId, filter);
      const analyticsData = analyticsResponse.data?.data || analyticsResponse.data || [];
      setMembers(analyticsData);
    } catch (err) {
      console.error('Failed to fetch analytics:', err);
      alert('Failed to load member analytics');
    } finally {
      setLoading(false);
    }
  };

  // Export members list as CSV (Workplan Gap Fix)
  const handleExport = async () => {
    try {
      const response = await reportService.exportMembersCSV(clubId);
      reportService.downloadBlob(response.data, `${club?.name || 'club'}-members.csv`);
    } catch (err) {
      console.error('Export failed:', err);
      alert('❌ Failed to export member list');
    }
  };

  const handleRemoveMember = async (memberId) => {
    if (!window.confirm('Remove this member from the club? This action cannot be undone.')) {
      return;
    }
    
    try {
      // TODO: Implement remove member API call
      alert('Remove member functionality will be implemented in backend');
      fetchData();
    } catch (err) {
      alert('Failed to remove member');
    }
  };

  // Filter and search
  const filteredMembers = members
    .filter(m => {
      const name = m.member?.name || m.user?.name || '';
      const roll = m.member?.rollNumber || m.user?.rollNumber || '';
      return name.toLowerCase().includes(searchTerm.toLowerCase()) ||
             roll.toLowerCase().includes(searchTerm.toLowerCase());
    })
    .sort((a, b) => {
      switch (sortBy) {
        case 'total':
          return (b.stats?.total || 0) - (a.stats?.total || 0);
        case 'rate':
          return (b.stats?.attendanceRate || 0) - (a.stats?.attendanceRate || 0);
        case 'lastActive':
          return new Date(b.lastActive || 0) - new Date(a.lastActive || 0);
        default:
          return 0;
      }
    });

  // Calculate summary stats
  const totalMembers = members.length;
  const activeMembers = members.filter(m => m.isActive).length;
  const inactiveMembers = totalMembers - activeMembers;
  const avgEvents = totalMembers > 0 
    ? (members.reduce((sum, m) => sum + (m.stats?.total || 0), 0) / totalMembers).toFixed(1)
    : 0;

  if (loading) {
    return (
      <Layout>
        <div className="loading">Loading analytics...</div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="member-analytics-page">
        <div className="analytics-header">
          <div className="header-content">
            <button onClick={() => navigate(`/clubs/${clubId}/dashboard`)} className="back-btn">
              ← Back to Dashboard
            </button>
            <h1>📊 Member Activity Analytics</h1>
            <p className="club-name">{club?.name}</p>
          </div>
        </div>

        <div className="summary-stats">
          <div className="stat-card">
            <div className="stat-icon">👥</div>
            <div className="stat-content">
              <p className="stat-label">Total Members</p>
              <p className="stat-value">{totalMembers}</p>
            </div>
          </div>
          
          <div className="stat-card success">
            <div className="stat-icon">✅</div>
            <div className="stat-content">
              <p className="stat-label">Active Members</p>
              <p className="stat-value">{activeMembers}</p>
              <p className="stat-subtitle">{totalMembers > 0 ? ((activeMembers/totalMembers)*100).toFixed(0) : 0}%</p>
            </div>
          </div>
          
          <div className="stat-card warning">
            <div className="stat-icon">⚠️</div>
            <div className="stat-content">
              <p className="stat-label">Inactive Members</p>
              <p className="stat-value">{inactiveMembers}</p>
              <p className="stat-subtitle">{totalMembers > 0 ? ((inactiveMembers/totalMembers)*100).toFixed(0) : 0}%</p>
            </div>
          </div>
          
          <div className="stat-card info">
            <div className="stat-icon">📈</div>
            <div className="stat-content">
              <p className="stat-label">Avg Events/Member</p>
              <p className="stat-value">{avgEvents}</p>
            </div>
          </div>
        </div>

        <div className="controls-section">
          <div className="filters">
            <select value={filter} onChange={(e) => setFilter(e.target.value)} className="filter-select">
              <option value="all">All Members</option>
              <option value="active">Active (3+ events)</option>
              <option value="inactive">Inactive (0-2 events)</option>
            </select>
            
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} className="sort-select">
              <option value="total">Sort by Total Events</option>
              <option value="rate">Sort by Attendance Rate</option>
              <option value="lastActive">Sort by Last Active</option>
            </select>
            
            <input
              type="text"
              placeholder="Search by name or roll number..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="search-input"
            />
            
            {/* Export CSV - Only for Coordinators and Admins */}
            {(user?.roles?.global === 'coordinator' || user?.roles?.global === 'admin') && (
              <button onClick={handleExport} className="btn-export">
                📅 Export CSV
              </button>
            )}
          </div>
        </div>

        {filteredMembers.length === 0 ? (
          <div className="no-data">
            <p>No members found</p>
          </div>
        ) : (
          <div className="members-table-container">
            <table className="members-table">
              <thead>
                <tr>
                  <th>Member</th>
                  <th>Role</th>
                  <th>Organized</th>
                  <th>Volunteered</th>
                  <th>Total Events</th>
                  <th>Attendance Rate</th>
                  <th>Last Active</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredMembers.map((memberData) => {
                  const member = memberData.member || memberData.user || {};
                  const stats = memberData.stats || {};
                  const isActive = memberData.isActive;
                  
                  return (
                    <tr key={member._id} className={isActive ? '' : 'inactive-row'}>
                      <td>
                        <div className="member-cell">
                          <div className="member-info">
                            <p className="member-name">{member.name}</p>
                            <p className="member-roll">{member.rollNumber}</p>
                          </div>
                        </div>
                      </td>
                      <td>
                        <span className="role-badge">{memberData.role || 'Member'}</span>
                      </td>
                      <td className="number-cell">{stats.organized || 0}</td>
                      <td className="number-cell">{stats.volunteered || 0}</td>
                      <td className="number-cell">
                        <strong>{stats.total || 0}</strong>
                      </td>
                      <td>
                        <span className={`rate-badge ${stats.attendanceRate >= 75 ? 'rate-good' : stats.attendanceRate >= 50 ? 'rate-medium' : 'rate-poor'}`}>
                          {stats.attendanceRate || 0}%
                        </span>
                      </td>
                      <td className="date-cell">
                        {memberData.lastActive 
                          ? new Date(memberData.lastActive).toLocaleDateString()
                          : 'Never'}
                      </td>
                      <td>
                        {isActive ? (
                          <span className="status-badge active">Active</span>
                        ) : (
                          <span className="status-badge inactive">Inactive</span>
                        )}
                      </td>
                      <td>
                        <div className="action-buttons">
                          <button
                            onClick={() => navigate(`/clubs/${clubId}/members/${member._id}/activity`)}
                            className="btn-view"
                          >
                            View Details
                          </button>
                          {!isActive && stats.total === 0 && (
                            <button
                              onClick={() => handleRemoveMember(member._id)}
                              className="btn-remove"
                            >
                              Remove
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Layout>
  );
};

export default MemberAnalyticsPage;
