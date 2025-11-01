import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import Layout from '../../components/Layout';
import clubService from '../../services/clubService';
import eventService from '../../services/eventService';
import { getClubLogoUrl, getClubLogoPlaceholder } from '../../utils/imageUtils';
import { hasCoreMemberRole, ROLE_DISPLAY_NAMES, LEADERSHIP_ROLES } from '../../utils/roleConstants';
import '../../styles/Clubs.css';

const ClubDetailPage = () => {
  const { clubId } = useParams();
  const { user, clubMemberships } = useAuth();
  const [club, setClub] = useState(null);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('about');

  useEffect(() => {
    fetchClubDetails();
  }, [clubId]);

  const fetchClubDetails = async () => {
    try {
      const [clubRes, eventsRes] = await Promise.all([
        clubService.getClub(clubId),
        eventService.list({ clubId, limit: 10 }),
      ]);
      // ✅ FIX: Axios returns full response object
      // Structure: response.data = { status, data: { club/events } }
      setClub(clubRes.data?.data?.club || clubRes.data?.club);
      setEvents(eventsRes.data?.data?.events || eventsRes.data?.events || []);
    } catch (error) {
      console.error('Error fetching club details:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <Layout>
        <div className="loading-container">
          <div className="spinner"></div>
          <p>Loading club details...</p>
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

  // ✅ Check if coordinator is assigned to THIS specific club
  const coordinatorId = club?.coordinator?._id || club?.coordinator;
  const userId = user?._id?.toString() || user?._id;
  const isAssignedCoordinator = user?.roles?.global === 'coordinator' && 
                                 coordinatorId?.toString() === userId;
  
  // ✅ Check if user has management role using clubMemberships (SINGLE SOURCE OF TRUTH)
  const hasManagementRole = hasCoreMemberRole(clubMemberships, clubId);
  
  const canManage = user?.roles?.global === 'admin' || 
                    isAssignedCoordinator ||
                    hasManagementRole;
  
  // ✅ Check if user has leadership role (for Edit Club button)
  const userMembership = clubMemberships?.find(m => m.club?.toString() === clubId?.toString());
  const userRole = userMembership?.role;
  const canEdit = LEADERSHIP_ROLES.includes(userRole);

  return (
    <Layout>
      <div className="club-detail-page">
        {/* Club Header */}
        <div className="club-header">
          <div className="club-header-content">
            <div className="club-logo-large">
              {getClubLogoUrl(club) ? (
                <img src={getClubLogoUrl(club)} alt={club.name} />
              ) : (
                <div className="club-logo-placeholder-large">
                  {getClubLogoPlaceholder(club)}
                </div>
              )}
            </div>
            <div className="club-header-info">
              <div className="club-title-row">
                <h1>{club.name}</h1>
                <span className={`badge badge-${club.status === 'active' ? 'success' : 'warning'}`}>
                  {club.status}
                </span>
              </div>
              <span className="club-category-large">{club.category}</span>
              <p className="club-description-large">{club.description}</p>
              
              <div className="club-meta">
                <div className="meta-item">
                  <span className="meta-icon">👥</span>
                  <span>{club.memberCount || 0} Members</span>
                </div>
                <div className="meta-item">
                  <span className="meta-icon">📅</span>
                  <span>{events.length} Events</span>
                </div>
                <div className="meta-item">
                  <span className="meta-icon">👨‍🏫</span>
                  <span>Coordinator: {club.coordinator?.profile?.name || 'N/A'}</span>
                </div>
              </div>

              <div className="club-actions">
                {canManage && (
                  <Link to={`/clubs/${clubId}/dashboard`} className="btn btn-primary">
                    📊 Dashboard
                  </Link>
                )}
                {canEdit && (
                  <Link to={`/clubs/${clubId}/edit`} className="btn btn-secondary">
                    ✏️ Edit Club
                  </Link>
                )}
                <Link to="/recruitments" className="btn btn-outline">
                  View Recruitments
                </Link>
              </div>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="tabs">
          <button
            className={`tab ${activeTab === 'about' ? 'active' : ''}`}
            onClick={() => setActiveTab('about')}
          >
            About
          </button>
          <button
            className={`tab ${activeTab === 'events' ? 'active' : ''}`}
            onClick={() => setActiveTab('events')}
          >
            Events
          </button>
          <button
            className={`tab ${activeTab === 'members' ? 'active' : ''}`}
            onClick={() => setActiveTab('members')}
          >
            Members
          </button>
        </div>

        {/* Tab Content */}
        <div className="tab-content">
          {activeTab === 'about' && (
            <div className="about-section">
              <div className="info-card">
                <h3>Vision</h3>
                <p>{club.vision || 'No vision statement available'}</p>
              </div>
              <div className="info-card">
                <h3>Mission</h3>
                <p>{club.mission || 'No mission statement available'}</p>
              </div>
              {club.socialMedia && Object.keys(club.socialMedia).length > 0 && (
                <div className="info-card">
                  <h3>Connect With Us</h3>
                  <div className="social-links">
                    {club.socialMedia.instagram && (
                      <a href={club.socialMedia.instagram} target="_blank" rel="noopener noreferrer" className="social-link">
                        📷 Instagram
                      </a>
                    )}
                    {club.socialMedia.twitter && (
                      <a href={club.socialMedia.twitter} target="_blank" rel="noopener noreferrer" className="social-link">
                        🐦 Twitter
                      </a>
                    )}
                    {club.socialMedia.linkedin && (
                      <a href={club.socialMedia.linkedin} target="_blank" rel="noopener noreferrer" className="social-link">
                        💼 LinkedIn
                      </a>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'events' && (
            <div className="events-section">
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
                          <span>📍 {event.venue}</span>
                          <span>🕐 {new Date(event.dateTime).toLocaleTimeString('en-US', { 
                            hour: '2-digit', 
                            minute: '2-digit' 
                          })}</span>
                          <span className={`badge badge-${event.status === 'published' ? 'success' : 'warning'}`}>
                            {event.status}
                          </span>
                        </div>
                      </div>
                      <Link to={`/events/${event._id}`} className="btn btn-outline">
                        View Details
                      </Link>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="no-data">
                  <p>No events scheduled yet</p>
                </div>
              )}
            </div>
          )}

          {activeTab === 'members' && (
            <div className="members-section">
              <div className="info-card">
                <h3>Club Members</h3>
                <p>Total Members: {club.memberCount || 0}</p>
                {canManage ? (
                  <div className="member-management-hint">
                    <p>To view and manage club members, go to the Dashboard.</p>
                    <Link to={`/clubs/${clubId}/dashboard`} className="btn btn-primary" style={{ marginTop: '1rem' }}>
                      📊 Go to Dashboard
                    </Link>
                  </div>
                ) : (
                  <p className="text-muted">Member list is only visible to club members and coordinators.</p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
};

export default ClubDetailPage;
