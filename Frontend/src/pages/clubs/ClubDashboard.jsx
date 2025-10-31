import React, { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import Layout from '../../components/Layout';
import clubService from '../../services/clubService';
import eventService from '../../services/eventService';
import userService from '../../services/userService';
import recruitmentService from '../../services/recruitmentService';
import analyticsService from '../../services/analyticsService';
import reportService from '../../services/reportService';
import { getClubLogoUrl, getClubLogoPlaceholder } from '../../utils/imageUtils';
import { ROLE_DISPLAY_NAMES, LEADERSHIP_ROLES, CORE_ROLES } from '../../utils/roleConstants';
import '../../styles/ClubDashboard.css';

const ClubDashboard = () => {
  const { clubId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [club, setClub] = useState(null);
  const [stats, setStats] = useState({
    totalMembers: 0,
    upcomingEvents: 0,
    activeRecruitments: 0,
    pendingApplications: 0,
  });
  const [events, setEvents] = useState([]);
  const [recruitments, setRecruitments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('overview');
  const [userRole, setUserRole] = useState(null);
  const [canManage, setCanManage] = useState(false);
  const [members, setMembers] = useState([]);
  const [showAddMemberModal, setShowAddMemberModal] = useState(false);
  const [selectedMember, setSelectedMember] = useState(null);
  const [showEditRoleModal, setShowEditRoleModal] = useState(false);
  const [showArchiveModal, setShowArchiveModal] = useState(false);
  const [archiveReason, setArchiveReason] = useState('');
  const [memberAnalytics, setMemberAnalytics] = useState({
    activeMembers: 0,
    inactiveMembers: 0,
    avgEventsPerMember: 0
  });

  useEffect(() => {
    fetchClubDashboardData();
    fetchMemberAnalytics();
  }, [clubId]);

  useEffect(() => {
    if (activeTab === 'members' && clubId) {
      fetchMembers();
    }
  }, [activeTab, clubId]);

  const fetchMemberAnalytics = async () => {
    try {
      const response = await analyticsService.getMemberAnalytics(clubId);
      // Backend: successResponse(res, { members, total }) → { status, data: { members, total } }
      const analyticsData = response.data?.members || [];
      
      if (!Array.isArray(analyticsData)) {
        console.warn('Analytics data is not an array:', analyticsData);
        return;
      }
      
      const activeCount = analyticsData.filter(m => m.isActive).length;
      const inactiveCount = analyticsData.length - activeCount;
      const avgEvents = analyticsData.length > 0 
        ? (analyticsData.reduce((sum, m) => sum + (m.stats?.total || 0), 0) / analyticsData.length).toFixed(1)
        : 0;
      
      setMemberAnalytics({
        activeMembers: activeCount,
        inactiveMembers: inactiveCount,
        avgEventsPerMember: avgEvents
      });
    } catch (error) {
      console.error('Error fetching member analytics:', error);
      // Silently fail - analytics is not critical
    }
  };

  const fetchClubDashboardData = async () => {
    try {
      const [clubRes, eventsRes, recruitmentsRes, myClubsRes] = await Promise.all([
        clubService.getClub(clubId),
        eventService.list({ club: clubId, limit: 10 }),
        recruitmentService.list({ club: clubId, limit: 10 }),
        userService.getMyClubs() // Get all user's clubs with roles
      ]);

      // Backend: successResponse(res, { club }) → { status, data: { club } }
      const clubData = clubRes.data?.club;
      setClub(clubData);
      
      // Backend: successResponse(res, { total, events }) → { status, data: { total, events } }
      const eventsData = eventsRes.data?.events || [];
      // Backend: successResponse(res, { recruitments, total }) → { status, data: { recruitments, total } }
      const recruitmentsData = recruitmentsRes.data?.recruitments || [];
      
      setEvents(eventsData);
      setRecruitments(recruitmentsData);

      // Calculate stats
      const upcomingEventsCount = eventsData.filter(e => 
        ['published', 'approved'].includes(e.status)
      ).length;
      
      const activeRecruitmentsCount = recruitmentsData.filter(r => 
        r.status === 'open'
      ).length;
      
      const pendingAppsCount = recruitmentsData.reduce((sum, rec) => 
        sum + (rec.applicationCount || 0), 0
      );

      setStats({
        totalMembers: clubData.memberCount || 0,
        upcomingEvents: upcomingEventsCount,
        activeRecruitments: activeRecruitmentsCount,
        pendingApplications: pendingAppsCount,
      });

      // Check if user has permission to manage this club
      // Backend: successResponse(res, { clubs }) → { status, data: { clubs } }
      const myClubs = myClubsRes.data?.clubs || [];
      const membership = myClubs.find(c => c.club?._id === clubId);
      
      if (membership) {
        // ✅ Backend returns: { club, role }
        // role can be: 'member' | 'core' | 'vicePresident' | 'secretary' | 'treasurer' | 'leadPR' | 'leadTech' | 'president'
        const role = membership.role;
        setUserRole(role); // Store role for display
        
        // ✅ Determine management permissions based on role hierarchy
        // President and Vice President have SAME permissions (leadership)
        const isLeadership = LEADERSHIP_ROLES.includes(role);
        const isCoreTeam = CORE_ROLES.includes(role);
        const isAdmin = user?.roles?.global === 'admin';
        
        // ✅ Coordinators can only VIEW if assigned to this club
        // Handle both populated object and ID string
        const coordinatorId = clubData?.coordinator?._id || clubData?.coordinator;
        const userId = user?._id?.toString() || user?._id;
        const isAssignedCoordinator = user?.roles?.global === 'coordinator' && 
                                       coordinatorId?.toString() === userId;
        
        // ✅ Leadership (president/vicePresident) has full management rights, core team has limited rights
        setCanManage(isLeadership || isCoreTeam || isAdmin || isAssignedCoordinator);
      } else {
        // Check if user is admin or assigned coordinator
        const isAdmin = user?.roles?.global === 'admin';
        // Handle both populated object and ID string
        const coordinatorId = clubData?.coordinator?._id || clubData?.coordinator;
        const userId = user?._id?.toString() || user?._id;
        const isAssignedCoordinator = user?.roles?.global === 'coordinator' && 
                                       coordinatorId?.toString() === userId;
        setCanManage(isAdmin || isAssignedCoordinator);
      }
    } catch (error) {
      console.error('Error fetching club dashboard data:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchMembers = async () => {
    try {
      console.log('Fetching members for club:', clubId);
      const response = await clubService.getMembers(clubId);
      console.log('Members response:', response);
      console.log('Members data:', response.data);
      
      // Backend returns: {data: {members: {total, page, limit, members: []}}}
      const membersData = response.data?.members;
      console.log('Extracted members data:', membersData);
      
      // Extract the actual array
      if (membersData && membersData.members && Array.isArray(membersData.members)) {
        console.log('Setting members array:', membersData.members);
        setMembers(membersData.members);
      } else if (Array.isArray(membersData)) {
        console.log('Members data is already an array:', membersData);
        setMembers(membersData);
      } else {
        console.warn('Unexpected members data format, setting empty array');
        setMembers([]);
      }
    } catch (error) {
      console.error('Error fetching members:', error);
      console.error('Error details:', error.response?.data);
      setMembers([]);
    }
  };

  const handleRemoveMember = async (memberId) => {
    if (!window.confirm('Are you sure you want to remove this member?')) return;
    
    try {
      await clubService.removeMember(clubId, memberId);
      alert('Member removed successfully!');
      fetchMembers(); // Refresh members list
    } catch (error) {
      alert(error.response?.data?.message || 'Failed to remove member');
    }
  };

  const handleApproveMember = async (memberId) => {
    if (!window.confirm('Approve this member?')) return;
    
    try {
      await clubService.approveMember(clubId, memberId);
      alert('Member approved successfully!');
      fetchMembers(); // Refresh members list
    } catch (error) {
      alert(error.response?.data?.message || 'Failed to approve member');
    }
  };

  const handleEditRole = (member) => {
    setSelectedMember(member);
    setShowEditRoleModal(true);
  };

  const handleArchiveClub = async () => {
    if (!archiveReason.trim()) {
      alert('Please provide a reason for archiving');
      return;
    }
    
    try {
      const response = await clubService.archiveClub(clubId, { reason: archiveReason });
      console.log('🔍 [Archive Response]', response);
      console.log('🔍 [Archive Club Status]', response?.data?.club?.status);
      console.log('🔍 [Archive Request]', response?.data?.club?.archiveRequest);
      
      const isPending = response.data?.club?.status === 'pending_archive';
      console.log('🔍 [Is Pending?]', isPending);
      
      const message = isPending 
        ? '📧 Archive request sent to coordinator for approval' 
        : '✅ Club archived successfully';
      alert(message);
      setShowArchiveModal(false);
      setArchiveReason('');
      if (!isPending) {
        navigate('/clubs');
      } else {
        console.log('🔄 [Refreshing club data...]');
        await fetchClubDashboardData(); // Refresh to show pending status
        console.log('✅ [Club data refreshed]');
      }
    } catch (error) {
      console.error('❌ [Archive Error]', error);
      console.error('❌ [Error Response]', error.response?.data);
      alert(error.response?.data?.message || '❌ Failed to archive club');
    }
  };
  
  const handleApproveArchive = async (decision) => {
    if (decision === 'approve') {
      if (!window.confirm('Approve this archive request? The club will be archived.')) return;
      
      try {
        await clubService.approveArchiveRequest(clubId, { approved: true });
        alert('✅ Club archived successfully!');
        navigate('/clubs');
      } catch (error) {
        console.error('Error approving archive:', error);
        alert(error.response?.data?.message || '❌ Failed to approve archive request');
      }
    } else {
      // Reject - need reason
      const reason = prompt('Please provide a reason for rejecting the archive request (minimum 10 characters):');
      if (!reason || reason.trim().length < 10) {
        alert('Rejection reason must be at least 10 characters');
        return;
      }
      
      try {
        await clubService.approveArchiveRequest(clubId, { approved: false, reason: reason.trim() });
        alert('✅ Archive request rejected');
        fetchClubDashboardData(); // Refresh to show active status
      } catch (error) {
        console.error('Error rejecting archive:', error);
        alert(error.response?.data?.message || '❌ Failed to reject archive request');
      }
    }
  };

  // Export club activity as CSV (Workplan Gap Fix)
  const handleExportActivity = async () => {
    try {
      const currentYear = new Date().getFullYear();
      const response = await reportService.exportClubActivityCSV(clubId, currentYear);
      reportService.downloadBlob(response.data, `${club.name}-activity-${currentYear}.csv`);
    } catch (error) {
      console.error('Error exporting activity:', error);
      alert('❌ Failed to export activity report');
    }
  };

  if (loading) {
    return (
      <Layout>
        <div className="loading-container">
          <div className="spinner"></div>
          <p>Loading club dashboard...</p>
        </div>
      </Layout>
    );
  }

  if (!club) {
    return (
      <Layout>
        <div className="error-container">
          <h2>Club not found</h2>
          <Link to="/clubs" className="btn btn-primary">Back to Clubs</Link>
        </div>
      </Layout>
    );
  }

  if (!canManage) {
    console.log('Access denied - canManage:', canManage, 'user:', user);
    return (
      <Layout>
        <div className="error-container">
          <h2>Access Denied</h2>
          <p>You don't have permission to manage this club</p>
          <Link to="/clubs" className="btn btn-primary">Back to Clubs</Link>
        </div>
      </Layout>
    );
  }

  console.log('Rendering dashboard - activeTab:', activeTab, 'members:', members);

  return (
    <Layout>
      <div className="club-dashboard">
        {/* Club Header */}
        <div className="club-dashboard-header">
          <div className="club-header-content">
            <div className="club-logo-container">
              {getClubLogoUrl(club) ? (
                <img src={getClubLogoUrl(club)} alt={club.name} className="club-logo" />
              ) : (
                <div className="club-logo-placeholder">
                  {getClubLogoPlaceholder(club)}
                </div>
              )}
            </div>
            <div className="club-info">
              <h1>{club.name}</h1>
              <p className="club-category">{club.category}</p>
              {club.status === 'pending_archive' && (
                <div className="alert alert-warning" style={{ marginTop: '0.5rem' }}>
                  ⏳ Archive request pending coordinator approval
                </div>
              )}
              {userRole && (
                <div className="user-roles">
                  <span className="role-badge">{ROLE_DISPLAY_NAMES[userRole] || userRole}</span>
                </div>
              )}
            </div>
          </div>
          <div className="header-actions">
            {/* ✅ Edit Club button - Only for Admin or Leadership (NOT coordinators) */}
            {(user?.roles?.global === 'admin' || LEADERSHIP_ROLES.includes(userRole)) && (
              <Link to={`/clubs/${clubId}/edit`} className="btn btn-outline">
                ⚙️ Edit Club
              </Link>
            )}
            <Link to={`/clubs/${clubId}`} className="btn btn-outline">
              View Public Page
            </Link>
            {/* Export Activity CSV - Only for Coordinators and Admins */}
            {(user?.roles?.global === 'coordinator' || user?.roles?.global === 'admin') && (
              <button onClick={handleExportActivity} className="btn btn-outline">
                Export Activity (CSV)
              </button>
            )}
            {/* Coordinator Approval Buttons for Archive Request */}
            {user?.roles?.global === 'coordinator' && club.status === 'pending_archive' && (
              <>
                <button 
                  onClick={() => handleApproveArchive('approve')} 
                  className="btn btn-success"
                  style={{ marginLeft: '0.5rem' }}
                >
                  ✅ Approve Archive
                </button>
                <button 
                  onClick={() => handleApproveArchive('reject')} 
                  className="btn btn-warning"
                  style={{ marginLeft: '0.5rem' }}
                >
                  ❌ Reject Archive
                </button>
              </>
            )}
            {/* ✅ Archive button - Only for Admin or Leadership (President/Vice President), not when pending */}
            {(user?.roles?.global === 'admin' || LEADERSHIP_ROLES.includes(userRole)) && club.status !== 'pending_archive' && (
              <button 
                onClick={() => setShowArchiveModal(true)} 
                className="btn btn-danger"
                style={{ marginLeft: '0.5rem' }}
              >
                🗑️ Archive Club
              </button>
            )}
          </div>
        </div>

        {/* Stats Cards */}
        <div className="stats-grid">
          <div className="stat-card stat-primary">
            <div className="stat-icon">👥</div>
            <div className="stat-content">
              <h3>{stats.totalMembers}</h3>
              <p>Total Members</p>
            </div>
          </div>
          <div className="stat-card stat-success">
            <div className="stat-icon">📅</div>
            <div className="stat-content">
              <h3>{stats.upcomingEvents}</h3>
              <p>Upcoming Events</p>
            </div>
          </div>
          <div className="stat-card stat-info">
            <div className="stat-icon">📝</div>
            <div className="stat-content">
              <h3>{stats.activeRecruitments}</h3>
              <p>Active Recruitments</p>
            </div>
          </div>
          <div className="stat-card stat-warning">
            <div className="stat-icon">📋</div>
            <div className="stat-content">
              <h3>{stats.pendingApplications}</h3>
              <p>Pending Applications</p>
            </div>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="quick-actions-section">
          <h2>Quick Actions</h2>
          <div className="actions-grid">
            <button 
              onClick={() => navigate(`/events/create?clubId=${clubId}`)} 
              className="action-card action-primary"
            >
              <span className="action-icon">➕</span>
              <h3>Create Event</h3>
              <p>Organize a new event</p>
            </button>
            <button 
              onClick={() => navigate(`/recruitments/create?clubId=${clubId}`)} 
              className="action-card action-success"
            >
              <span className="action-icon">📝</span>
              <h3>Start Recruitment</h3>
              <p>Recruit new members</p>
            </button>
            <button 
              onClick={() => navigate(`/clubs/${clubId}/registrations`)} 
              className="action-card action-secondary"
            >
              <span className="action-icon">🎭</span>
              <h3>Event Registrations</h3>
              <p>Approve performer registrations</p>
            </button>
            <button 
              onClick={() => setActiveTab('members')} 
              className="action-card action-info"
            >
              <span className="action-icon">👥</span>
              <h3>Manage Members</h3>
              <p>View and manage members</p>
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="tabs">
          <button
            className={`tab ${activeTab === 'overview' ? 'active' : ''}`}
            onClick={() => setActiveTab('overview')}
          >
            Overview
          </button>
          <button
            className={`tab ${activeTab === 'events' ? 'active' : ''}`}
            onClick={() => setActiveTab('events')}
          >
            Events ({events.length})
          </button>
          <button
            className={`tab ${activeTab === 'recruitments' ? 'active' : ''}`}
            onClick={() => setActiveTab('recruitments')}
          >
            Recruitments ({recruitments.length})
          </button>
          <button
            className={`tab ${activeTab === 'members' ? 'active' : ''}`}
            onClick={() => setActiveTab('members')}
          >
            Members ({stats.totalMembers})
          </button>
          {/* <button
            className={`tab ${activeTab === 'documents' ? 'active' : ''}`}
            onClick={() => setActiveTab('documents')}
          >
            Documents
          </button> */}
        </div>

        {/* Tab Content */}
        <div className="tab-content">
          {activeTab === 'overview' && (
            <div className="overview-section">
              <div className="overview-grid">
                <div className="info-card">
                  <h3>About {club.name}</h3>
                  <p>{club.description || 'No description available'}</p>
                  <div className="club-details">
                    <div className="detail-item">
                      <strong>Category:</strong> {club.category}
                    </div>
                    <div className="detail-item">
                      <strong>Status:</strong> 
                      <span className={`badge badge-${club.status === 'active' ? 'success' : 'warning'}`}>
                        {club.status}
                      </span>
                    </div>
                    <div className="detail-item">
                      <strong>Coordinator:</strong> {club.coordinator?.profile?.name || 'N/A'}
                    </div>
                  </div>
                </div>

                <div className="info-card">
                  <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                    <h3>📅 Recent Events</h3>
                    <Link to={`#`} onClick={() => setActiveTab('events')} className="btn-link">
                      View All ({events.length})
                    </Link>
                  </div>
                  <div className="activity-list">
                    {events.slice(0, 3).map((event) => (
                      <div key={event._id} className="activity-item" style={{ 
                        padding: '0.75rem', 
                        borderBottom: '1px solid #e2e8f0',
                        cursor: 'pointer'
                      }}
                      onClick={() => navigate(`/events/${event._id}`)}
                      >
                        <span className="activity-icon">📅</span>
                        <div className="activity-info" style={{ flex: 1 }}>
                          <p><strong>{event.title}</strong></p>
                          <p className="activity-meta" style={{ fontSize: '0.875rem', color: '#64748b', marginTop: '0.25rem' }}>
                            📍 {event.venue || 'TBA'} • 🕐 {new Date(event.dateTime).toLocaleDateString()}
                          </p>
                        </div>
                        <span className={`badge badge-${
                          event.status === 'published' ? 'success' : 
                          event.status === 'ongoing' ? 'info' :
                          event.status === 'draft' ? 'secondary' : 'warning'
                        }`} style={{ alignSelf: 'center' }}>
                          {event.status}
                        </span>
                      </div>
                    ))}
                    {events.length === 0 && (
                      <div style={{ textAlign: 'center', padding: '2rem', color: '#94a3b8' }}>
                        <p className="no-data">No events yet</p>
                        <Link to={`/events/create?clubId=${clubId}`} className="btn btn-primary" style={{ marginTop: '1rem' }}>
                          + Create First Event
                        </Link>
                      </div>
                    )}
                  </div>
                </div>

                {/* Member Analytics Widget */}
                {canManage && (
                  <div className="info-card member-analytics-widget">
                    <div className="widget-header">
                      <h3>📊 Member Activity</h3>
                      <button 
                        onClick={() => navigate(`/clubs/${clubId}/member-analytics`)}
                        className="btn-link"
                      >
                        View Full Analytics →
                      </button>
                    </div>
                    <div className="analytics-quick-stats">
                      <div className="quick-stat">
                        <span className="stat-icon success">✅</span>
                        <div className="stat-info">
                          <p className="stat-label">Active Members</p>
                          <p className="stat-value">{memberAnalytics.activeMembers}</p>
                        </div>
                      </div>
                      <div className="quick-stat">
                        <span className="stat-icon warning">⚠️</span>
                        <div className="stat-info">
                          <p className="stat-label">Inactive Members</p>
                          <p className="stat-value">{memberAnalytics.inactiveMembers}</p>
                        </div>
                      </div>
                      <div className="quick-stat">
                        <span className="stat-icon info">📈</span>
                        <div className="stat-info">
                          <p className="stat-label">Avg Events/Member</p>
                          <p className="stat-value">{memberAnalytics.avgEventsPerMember}</p>
                        </div>
                      </div>
                    </div>
                    {memberAnalytics.inactiveMembers > 0 && (
                      <div className="analytics-alert">
                        <p>⚠️ {memberAnalytics.inactiveMembers} members have participated in fewer than 3 events</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'events' && (
            <div className="events-section">
              <div className="section-header">
                <h2>Club Events</h2>
                <Link to={`/events/create?clubId=${clubId}`} className="btn btn-primary">
                  + Create Event
                </Link>
              </div>
              {events.length > 0 ? (
                <div className="events-list">
                  {events.map((event) => (
                    <div key={event._id} className="event-card">
                      <div className="event-date-badge">
                        <span className="day">{new Date(event.dateTime).getDate()}</span>
                        <span className="month">
                          {new Date(event.dateTime).toLocaleString('default', { month: 'short' })}
                        </span>
                      </div>
                      <div className="event-details">
                        <h3>{event.title}</h3>
                        <p className="event-description">{event.description}</p>
                        <div className="event-meta">
                          <span>📍 {event.venue || 'TBA'}</span>
                          <span>🕐 {new Date(event.dateTime).toLocaleTimeString('en-US', { 
                            hour: '2-digit', 
                            minute: '2-digit' 
                          })}</span>
                          <span className={`badge badge-${
                            event.status === 'published' ? 'success' : 
                            event.status === 'approved' ? 'info' : 'warning'
                          }`}>
                            {event.status}
                          </span>
                        </div>
                      </div>
                      <div className="event-actions">
                        <Link to={`/events/${event._id}`} className="btn btn-primary btn-sm">
                          View & Manage
                        </Link>
                        {/* Note: Events cannot be edited once created. Use status transitions in detail page. */}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="no-data">
                  <p>No events created yet</p>
                  <Link to={`/events/create?clubId=${clubId}`} className="btn btn-primary">
                    Create Your First Event
                  </Link>
                </div>
              )}
            </div>
          )}

          {activeTab === 'recruitments' && (
            <div className="recruitments-section">
              <div className="section-header">
                <h2>Recruitments</h2>
                <Link to={`/recruitments/create?clubId=${clubId}`} className="btn btn-primary">
                  + Start Recruitment
                </Link>
              </div>
              {recruitments.length > 0 ? (
                <div className="recruitments-grid">
                  {recruitments.map((recruitment) => (
                    <div key={recruitment._id} className="recruitment-card">
                      <div className="card-header">
                        <h3>{recruitment.title}</h3>
                        <span className={`badge badge-${
                          recruitment.status === 'open' ? 'success' : 
                          recruitment.status === 'closing_soon' ? 'warning' : 'secondary'
                        }`}>
                          {recruitment.status}
                        </span>
                      </div>
                      <p className="card-description">{recruitment.description}</p>
                      <div className="card-meta">
                        <span>📅 Ends: {new Date(recruitment.endDate).toLocaleDateString()}</span>
                        <span>👥 {recruitment.applicationCount || 0} applications</span>
                      </div>
                      <div className="card-actions">
                        <Link to={`/recruitments/${recruitment._id}`} className="btn btn-outline btn-sm">
                          View Details
                        </Link>
                        <Link to={`/recruitments/${recruitment._id}/applications`} className="btn btn-primary btn-sm">
                          Review Applications
                        </Link>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="no-data">
                  <p>No recruitments yet</p>
                  <Link to={`/recruitments/create?clubId=${clubId}`} className="btn btn-primary">
                    Start Your First Recruitment
                  </Link>
                </div>
              )}
            </div>
          )}

          {activeTab === 'members' && (
            <div className="members-section">
              <div className="section-header">
                <h2>Club Members ({members?.length || 0})</h2>
                {/* ✅ All who can manage (admin, coordinator, leadership, core) can add members */}
                {canManage && (
                  <button 
                    className="btn btn-primary" 
                    onClick={() => setShowAddMemberModal(true)}
                  >
                    + Add Member
                  </button>
                )}
              </div>
              
              <div className="members-grid">
                {!members || members.length === 0 ? (
                  <div className="info-card">
                    <p className="text-muted">No members found. Add members to get started.</p>
                  </div>
                ) : (
                  members.map((member) => member && member._id ? (
                    <div key={member._id} className="member-card">
                      <div className="member-avatar">
                        {member.user?.profile?.profilePhoto ? (
                          <img 
                            src={member.user.profile.profilePhoto} 
                            alt={member.user?.profile?.name || 'User'} 
                            className="member-avatar-img"
                          />
                        ) : (
                          <span className="member-avatar-placeholder">
                            {member.user?.profile?.name?.charAt(0) || member.user?.email?.charAt(0) || 'U'}
                          </span>
                        )}
                      </div>
                      <div className="member-info">
                        <h4>{member.user?.profile?.name || member.user?.email || 'Unknown'}</h4>
                        <p className="member-email">{member.user?.email || ''}</p>
                        {/* ✅ Added department and batch info */}
                        {(member.user?.profile?.department || member.user?.profile?.batch) && (
                          <p className="member-details">
                            {member.user?.profile?.department && <span>{member.user.profile.department}</span>}
                            {member.user?.profile?.department && member.user?.profile?.batch && <span> • </span>}
                            {member.user?.profile?.batch && <span>{member.user.profile.batch}</span>}
                          </p>
                        )}
                        <div className="member-badges">
                          <span className={`badge badge-${
                            member.role === 'president' ? 'primary' : 
                            member.role === 'core' || ['vicePresident', 'secretary', 'treasurer', 'leadPR', 'leadTech'].includes(member.role) ? 'info' : 
                            'secondary'
                          }`}>
                            {ROLE_DISPLAY_NAMES[member.role] || member.role || 'member'}
                          </span>
                          <span className={`badge badge-${member.status === 'approved' ? 'success' : 'warning'}`}>
                            {member.status || 'pending'}
                          </span>
                        </div>
                      </div>
                      {canManage && (() => {
                        const isLeadership = LEADERSHIP_ROLES.includes(userRole);
                        const isCoreOnly = CORE_ROLES.includes(userRole);
                        const isAdmin = user?.roles?.global === 'admin';
                        const isCoordinator = user?.roles?.global === 'coordinator';
                        const memberIsLeadership = LEADERSHIP_ROLES.includes(member.role);
                        const memberIsCoreOnly = CORE_ROLES.includes(member.role);
                        const memberIsElevated = [...CORE_ROLES, ...LEADERSHIP_ROLES].includes(member.role);
                        const isSelf = member.user?._id === user?._id;
                        
                        // ✅ Access control:
                        // - Admin can edit/remove anyone
                        // - Coordinator can ONLY remove Leadership (to replace them, NOT edit)
                        // - Leadership can ONLY edit/remove Core and Members (NOT other leadership)
                        // - Core can ONLY remove Members (NO edit button - they can only add)
                        const canEditThisMember = isAdmin || 
                                                 (isLeadership && !memberIsLeadership);
                        const canRemoveThisMember = isAdmin || 
                                                   (isCoordinator && memberIsLeadership) ||
                                                   (isLeadership && !memberIsLeadership && !isSelf) || 
                                                   (isCoreOnly && !memberIsElevated && !isSelf);
                        
                        return (
                          <div className="member-actions">
                            {member.status === 'pending' && (
                              <button 
                                className="btn btn-sm btn-success"
                                onClick={() => handleApproveMember(member._id)}
                              >
                                ✓ Approve
                              </button>
                            )}
                            {canEditThisMember && (
                              <button 
                                className="btn btn-sm btn-secondary"
                                onClick={() => handleEditRole(member)}
                                title={
                                  isCoordinator ? 'Coordinator can only edit Sr/Jr Club Head roles' :
                                  memberIsLeadership && !isAdmin && !isCoordinator ? 'Only Admin or Coordinator can edit President/Vice President roles' :
                                  isCoreOnly ? 'Core members can only change non-core members to member role' : ''
                                }
                              >
                                Edit Role
                              </button>
                            )}
                            {canRemoveThisMember && (
                              <button 
                                className="btn btn-sm btn-danger"
                                onClick={() => handleRemoveMember(member._id)}
                                title={
                                  isCoordinator ? 'Coordinator can only remove Sr/Jr Club Head' :
                                  memberIsLeadership && !isAdmin && !isCoordinator ? 'Only Admin or Coordinator can remove President/Vice President' :
                                  isSelf ? 'Cannot remove yourself' : ''
                                }
                              >
                                Remove
                              </button>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  ) : null)
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Add Member Modal */}
      {showAddMemberModal && (
        <AddMemberModal
          clubId={clubId}
          userRole={userRole}
          onClose={() => setShowAddMemberModal(false)}
          onSuccess={() => {
            fetchMembers();
            fetchClubDashboardData();
            setShowAddMemberModal(false);
          }}
        />
      )}

      {/* Edit Role Modal */}
      {showEditRoleModal && selectedMember && (
        <EditRoleModal
          clubId={clubId}
          member={selectedMember}
          userRole={userRole}
          onClose={() => {
            setShowEditRoleModal(false);
            setSelectedMember(null);
          }}
          onSuccess={() => {
            fetchMembers();
            setShowEditRoleModal(false);
            setSelectedMember(null);
          }}
        />
      )}

      {/* Archive Club Modal */}
      {showArchiveModal && (
        <div className="modal-overlay" onClick={() => setShowArchiveModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Archive Club</h2>
              <button className="btn-close" onClick={() => setShowArchiveModal(false)}>×</button>
            </div>
            <div className="modal-body">
              <p className="text-muted" style={{ marginBottom: '1rem' }}>
                {user?.roles?.global === 'admin' 
                  ? 'You are about to archive this club. This will hide it from active listings.'
                  : 'Your archive request will be sent to the assigned coordinator for approval.'
                }
              </p>
              <div className="form-group">
                <label>Reason for Archiving *</label>
                <textarea
                  value={archiveReason}
                  onChange={(e) => setArchiveReason(e.target.value)}
                  placeholder="Please provide a reason for archiving this club (minimum 10 characters)"
                  rows="4"
                  className="form-control"
                  style={{ width: '100%' }}
                />
              </div>
            </div>
            <div className="modal-footer">
              <button onClick={() => setShowArchiveModal(false)} className="btn btn-secondary">
                Cancel
              </button>
              <button 
                onClick={handleArchiveClub} 
                className="btn btn-danger"
                disabled={!archiveReason.trim() || archiveReason.length < 10}
              >
                {user?.roles?.global === 'admin' ? 'Archive Now' : 'Request Archive'}
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
};

// Add Member Modal Component
const AddMemberModal = ({ clubId, userRole, onClose, onSuccess }) => {
  const { user } = useAuth();
  const [userId, setUserId] = useState('');
  
  // ✅ Set default role based on user permissions
  const isAdmin = user?.roles?.global === 'admin';
  const isCoordinator = user?.roles?.global === 'coordinator';
  const isLeadership = LEADERSHIP_ROLES.includes(userRole);
  const isCoreOnly = CORE_ROLES.includes(userRole);
  
  // Coordinator defaults to 'president', others default to 'member'
  const defaultRole = isCoordinator ? 'president' : 'member';
  const [role, setRole] = useState(defaultRole);
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [users, setUsers] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [fetchingUsers, setFetchingUsers] = useState(true);

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    setFetchingUsers(true);
    try {
      // Backend validator max limit is 100
      const response = await userService.listUsers({ limit: 100 });
      console.log('Users API response:', response);
      // Backend: successResponse(res, { total, users }) → { status, data: { total, users } }
      setUsers(response.data?.users || []);
    } catch (err) {
      console.error('Error fetching users:', err);
      setError('Failed to load users. Please try again.');
    } finally {
      setFetchingUsers(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!userId) {
      setError('Please select a user');
      return;
    }
    
    setLoading(true);
    setError('');

    try {
      await clubService.addMember(clubId, { userId, role });
      alert('✅ Member added successfully!');
      onSuccess();
    } catch (err) {
      const errorMsg = err.response?.data?.message || 'Failed to add member';
      setError(errorMsg);
      console.error('Error adding member:', err.response?.data);
    } finally {
      setLoading(false);
    }
  };

  // Fixed: rollNumber is direct property, not inside profile
  const filteredUsers = users.filter(u => {
    if (!searchTerm) return false; // Only show users when searching
    
    const searchLower = searchTerm.toLowerCase().trim();
    if (!searchLower) return false;
    
    const rollNumber = (u.rollNumber || '').toLowerCase();
    const email = (u.email || '').toLowerCase();
    const name = (u.profile?.name || '').toLowerCase();
    
    return rollNumber.includes(searchLower) || 
           email.includes(searchLower) ||
           name.includes(searchLower);
  });

  // ✅ ACCESS CONTROL: Restrict role options based on user's role
  // (Permission variables already defined at top of component)
  
  const leadershipRoles = [
    { value: 'president', label: ROLE_DISPLAY_NAMES.president },  // Sr Club Head
    { value: 'vicePresident', label: ROLE_DISPLAY_NAMES.vicePresident }  // Jr Club Head
  ];
  
  const coreRoles = [
    { value: 'core', label: ROLE_DISPLAY_NAMES.core },
    { value: 'secretary', label: ROLE_DISPLAY_NAMES.secretary },
    { value: 'treasurer', label: ROLE_DISPLAY_NAMES.treasurer },
    { value: 'leadPR', label: ROLE_DISPLAY_NAMES.leadPR },
    { value: 'leadTech', label: ROLE_DISPLAY_NAMES.leadTech }
  ];
  
  const memberRole = [{ value: 'member', label: ROLE_DISPLAY_NAMES.member }];
  
  // Determine available roles based on user permissions
  let roles;
  if (isAdmin) {
    // Admin can assign all roles
    roles = [...memberRole, ...coreRoles, ...leadershipRoles];
  } else if (isCoordinator) {
    // Coordinator can ONLY assign leadership roles (President/Vice President)
    roles = leadershipRoles;
  } else if (isLeadership) {
    // Leadership can ONLY add core and regular members (NOT other leadership)
    roles = [...memberRole, ...coreRoles];
  } else if (isCoreOnly) {
    // Core members can only add regular members
    roles = memberRole;
  } else {
    roles = memberRole;
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Add Member</h2>
          <button className="btn-close" onClick={onClose}>×</button>
        </div>

        {error && <div className="alert alert-error">{error}</div>}

        <form onSubmit={handleSubmit} className="form">
          <div className="form-group">
            <label>Search User *</label>
            <input
              type="text"
              className="form-control"
              placeholder="Type roll number, name, or email to search..."
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setUserId(''); // Reset selection when search changes
              }}
              autoFocus
            />
            <small className="form-hint">
              {fetchingUsers ? 'Loading users...' : 
               searchTerm ? `${filteredUsers.length} user(s) found` : 
               'Start typing to search users'}
            </small>
          </div>

          <div className="form-group">
            <label>Select User *</label>
            <select
              className="form-control"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              required
              disabled={!searchTerm || filteredUsers.length === 0}
            >
              <option value="">
                {!searchTerm ? '-- Search first to see users --' :
                 filteredUsers.length === 0 ? '-- No users found --' :
                 '-- Select a user --'}
              </option>
              {filteredUsers.map(u => (
                <option key={u._id} value={u._id}>
                  {u.rollNumber || 'No Roll Number'} | {u.profile?.name || 'No Name'} | {u.email}
                </option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label>Role *</label>
            <select
              className="form-control"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              required
            >
              {roles.map(r => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
            <small className="form-hint">
              {isCoreOnly ? (
                <span className="text-warning">⚠️ Core members can only add regular members.</span>
              ) : isLeadership ? (
                <span className="text-info">ℹ️ You can assign Core and Member roles. Coordinator handles Sr/Jr Club Head assignments.</span>
              ) : isCoordinator ? (
                <span className="text-info">ℹ️ Coordinator can only assign Sr Club Head and Jr Club Head roles. Leadership handles other roles.</span>
              ) : (
                'Select the role for this member in the club'
              )}
            </small>
          </div>

          <div className="modal-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button 
              type="submit" 
              className="btn btn-primary" 
              disabled={loading || !userId}
            >
              {loading ? 'Adding...' : 'Add Member'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// Edit Role Modal Component
const EditRoleModal = ({ clubId, member, userRole, onClose, onSuccess }) => {
  const { user } = useAuth();
  const [role, setRole] = useState(member.role);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // ✅ ACCESS CONTROL: Restrict role options based on user's role
  const isAdmin = user?.roles?.global === 'admin';
  const isCoordinator = user?.roles?.global === 'coordinator';
  const isLeadership = LEADERSHIP_ROLES.includes(userRole);
  const isCoreOnly = CORE_ROLES.includes(userRole);
  
  const leadershipRoles = ['president', 'vicePresident'];
  const coreRoles = ['core', 'secretary', 'treasurer', 'leadPR', 'leadTech'];
  const memberRole = ['member'];
  
  // Determine available roles based on user permissions
  let roles;
  if (isAdmin) {
    // Admin can assign all roles
    roles = [...memberRole, ...coreRoles, ...leadershipRoles];
  } else if (isCoordinator) {
    // Coordinator can ONLY change leadership roles (President/Vice President)
    roles = leadershipRoles;
  } else if (isLeadership) {
    // Leadership can ONLY change to core and member roles (NOT other leadership)
    roles = [...memberRole, ...coreRoles];
  } else if (isCoreOnly) {
    // Core members can only change to member role
    roles = memberRole;
  } else {
    roles = memberRole;
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      await clubService.updateMemberRole(clubId, member._id, { role });
      alert('✅ Role updated successfully!');
      onSuccess();
    } catch (err) {
      const errorMsg = err.response?.data?.message || 'Failed to update role';
      setError(errorMsg);
      console.error('Error updating role:', err.response?.data);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Edit Member Role</h2>
          <button className="btn-close" onClick={onClose}>×</button>
        </div>

        {error && <div className="alert alert-error">{error}</div>}

        <form onSubmit={handleSubmit} className="form">
          <div className="form-group">
            <label>Member</label>
            <input
              type="text"
              value={member.user?.profile?.name || 'Unknown'}
              disabled
            />
          </div>

          <div className="form-group">
            <label>New Role *</label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              required
            >
              {roles.map(r => (
                <option key={r} value={r}>
                  {ROLE_DISPLAY_NAMES[r] || r}
                </option>
              ))}
            </select>
            <small className="form-hint">
              {isCoreOnly ? (
                <span className="text-warning">⚠️ Core members can only change to regular member role.</span>
              ) : isLeadership ? (
                <span className="text-info">ℹ️ You can assign Core and Member roles. Coordinator handles Sr/Jr Club Head role changes.</span>
              ) : isCoordinator ? (
                <span className="text-info">ℹ️ Coordinator can only change Sr Club Head and Jr Club Head roles. Leadership handles other roles.</span>
              ) : (
                'Select the new role for this member'
              )}
            </small>
          </div>

          <div className="modal-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? 'Updating...' : 'Update Role'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default ClubDashboard;
