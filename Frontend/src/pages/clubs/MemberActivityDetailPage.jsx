import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import analyticsService from '../../services/analyticsService';
import Layout from '../../components/Layout';
import './MemberActivityDetailPage.css';

const MemberActivityDetailPage = () => {
  const { clubId, memberId } = useParams();
  const navigate = useNavigate();
  
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData();
  }, [clubId, memberId]);

  const fetchData = async () => {
    try {
      setLoading(true);
      const response = await analyticsService.getMemberActivity(clubId, memberId);
      const activityData = response.data?.data || response.data;
      setData(activityData);
    } catch (err) {
      console.error('Failed to fetch member activity:', err);
      alert('Failed to load member activity: ' + (err.response?.data?.message || err.message));
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <Layout>
        <div className="loading">Loading member activity...</div>
      </Layout>
    );
  }

  if (!data) {
    return (
      <Layout>
        <div className="error">No data received from server</div>
      </Layout>
    );
  }

  if (!data.member) {
    return (
      <Layout>
        <div className="error">
          <h3>Member not found</h3>
          <p>Data structure: {JSON.stringify(Object.keys(data))}</p>
        </div>
      </Layout>
    );
  }

  const member = data.member || {};
  const stats = data.stats || {};
  const events = data.eventHistory || [];

  return (
    <Layout>
      <div className="member-activity-detail-page" style={{ padding: '20px', maxWidth: '1200px', margin: '0 auto' }}>
        <div className="page-header" style={{ marginBottom: '30px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexDirection: 'row' }}>
          <h1 style={{ fontSize: '28px', fontWeight: '600', color: '#1a1a1a', margin: '0', order: 1 }}>Member Activity Details</h1>
          <button 
            onClick={() => navigate(`/clubs/${clubId}/member-analytics`)} 
            className="back-btn"
            style={{
              background: '#9ebedeff',
              color: 'white',
              border: 'none',
              padding: '10px 20px',
              borderRadius: '6px',
              fontSize: '14px',
              fontWeight: '500',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              transition: 'background 0.2s',
              order: 2,
              marginLeft: '1000px'
            }}
            onMouseEnter={(e) => e.target.style.background = '#0052a3'}
            onMouseLeave={(e) => e.target.style.background = '#0066cc'}
          >
            ← Back to Analytics
          </button>
        </div>

        <div className="member-profile" style={{ marginBottom: '30px' }}>
          <div className="profile-card" style={{ 
            padding: '30px', 
            background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', 
            borderRadius: '12px',
            boxShadow: '0 4px 6px rgba(0,0,0,0.1)'
          }}>
            <div className="profile-info">
              <h2 style={{ color: '#fff', fontSize: '28px', marginBottom: '15px', fontWeight: '600' }}>{member.name}</h2>
              <p className="roll-number" style={{ color: 'rgba(255,255,255,0.9)', fontSize: '16px', margin: '8px 0', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '18px' }}>📋</span> {member.rollNumber}
              </p>
              <p className="email" style={{ color: 'rgba(255,255,255,0.9)', fontSize: '14px', margin: '8px 0', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '18px' }}>📧</span> {member.email}
              </p>
              <p className="club-role" style={{ 
                color: '#fff', 
                fontSize: '15px', 
                fontWeight: '600', 
                margin: '15px 0 0 0',
                padding: '8px 16px',
                background: 'rgba(255,255,255,0.2)',
                borderRadius: '20px',
                display: 'inline-block'
              }}>
                🎯 Role: {member.clubRole || 'Member'}
              </p>
            </div>
          </div>
        </div>

        <div className="activity-summary" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '20px', marginBottom: '30px' }}>
          <div className="summary-card" style={{ 
            background: '#fff', 
            padding: '24px', 
            borderRadius: '12px', 
            border: 'none',
            boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
            textAlign: 'center',
            transition: 'transform 0.2s, box-shadow 0.2s'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = 'translateY(-4px)';
            e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'translateY(0)';
            e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.08)';
          }}>
            <div className="summary-icon" style={{ fontSize: '40px', marginBottom: '12px' }}>📊</div>
            <div className="summary-content">
              <p className="summary-label" style={{ color: '#888', fontSize: '13px', fontWeight: '500', margin: '0 0 8px 0', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Total Events</p>
              <p className="summary-value" style={{ color: '#1a1a1a', fontSize: '32px', fontWeight: '700', margin: '0' }}>{stats.totalEvents || 0}</p>
            </div>
          </div>
          
          <div className="summary-card" style={{ 
            background: '#fff', 
            padding: '24px', 
            borderRadius: '12px', 
            border: 'none',
            boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
            textAlign: 'center',
            transition: 'transform 0.2s, box-shadow 0.2s'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = 'translateY(-4px)';
            e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'translateY(0)';
            e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.08)';
          }}>
            <div className="summary-icon" style={{ fontSize: '40px', marginBottom: '12px' }}>🎯</div>
            <div className="summary-content">
              <p className="summary-label" style={{ color: '#888', fontSize: '13px', fontWeight: '500', margin: '0 0 8px 0', textTransform: 'uppercase', letterSpacing: '0.5px' }}>As Organizer</p>
              <p className="summary-value" style={{ color: '#1a1a1a', fontSize: '32px', fontWeight: '700', margin: '0' }}>{stats.organizerEvents || 0}</p>
            </div>
          </div>
          
          <div className="summary-card" style={{ 
            background: '#fff', 
            padding: '24px', 
            borderRadius: '12px', 
            border: 'none',
            boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
            textAlign: 'center',
            transition: 'transform 0.2s, box-shadow 0.2s'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = 'translateY(-4px)';
            e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'translateY(0)';
            e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.08)';
          }}>
            <div className="summary-icon" style={{ fontSize: '40px', marginBottom: '12px' }}>🤝</div>
            <div className="summary-content">
              <p className="summary-label" style={{ color: '#888', fontSize: '13px', fontWeight: '500', margin: '0 0 8px 0', textTransform: 'uppercase', letterSpacing: '0.5px' }}>As Volunteer</p>
              <p className="summary-value" style={{ color: '#1a1a1a', fontSize: '32px', fontWeight: '700', margin: '0' }}>{stats.volunteerEvents || 0}</p>
            </div>
          </div>
          
          <div className="summary-card" style={{ 
            background: '#fff', 
            padding: '24px', 
            borderRadius: '12px', 
            border: 'none',
            boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
            textAlign: 'center',
            transition: 'transform 0.2s, box-shadow 0.2s'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = 'translateY(-4px)';
            e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'translateY(0)';
            e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.08)';
          }}>
            <div className="summary-icon" style={{ fontSize: '40px', marginBottom: '12px' }}>✅</div>
            <div className="summary-content">
              <p className="summary-label" style={{ color: '#888', fontSize: '13px', fontWeight: '500', margin: '0 0 8px 0', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Attendance Rate</p>
              <p className="summary-value" style={{ color: '#10b981', fontSize: '32px', fontWeight: '700', margin: '0' }}>{stats.participationRate || 0}%</p>
            </div>
          </div>
        </div>

        <div className="event-history">
          <div className="history-header">
            <h2>📅 Event History</h2>
            <p className="subtitle">{events.length} events participated</p>
          </div>

          {events.length === 0 ? (
            <div className="no-events">
              <p>No event participation history yet</p>
            </div>
          ) : (
            <div className="events-table-container">
              <table className="events-table">
                <thead>
                  <tr>
                    <th>Event</th>
                    <th>Date</th>
                    <th>Role</th>
                    <th>Attendance</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((evt) => {
                    return (
                      <tr key={evt.eventId}>
                        <td>
                          <div className="event-cell">
                            <p className="event-title">{evt.title}</p>
                            <p className="event-venue">{evt.venue || 'TBA'}</p>
                          </div>
                        </td>
                        <td className="date-cell">
                          {new Date(evt.date).toLocaleDateString('en-US', {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric'
                          })}
                        </td>
                        <td>
                          <span className={`role-badge role-${evt.role}`}>
                            {evt.role === 'organizer' 
                              ? '🎯 Organizer' 
                              : '🤝 Volunteer'}
                          </span>
                        </td>
                        <td>
                          {evt.attended ? (
                            <span className="attendance-badge present">✅ Present</span>
                          ) : evt.attendanceStatus === 'absent' ? (
                            <span className="attendance-badge absent">❌ Absent</span>
                          ) : (
                            <span className="attendance-badge pending">⏳ Pending</span>
                          )}
                        </td>
                        <td>
                          <span className={`event-status-badge status-${evt.status}`}>
                            {evt.status}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="activity-timeline">
          <h2>📈 Activity Timeline</h2>
          {events.length > 0 ? (
            <div className="timeline">
              {events.slice(0, 5).map((evt, index) => {
                return (
                  <div key={index} className="timeline-item">
                    <div className="timeline-marker">
                      {evt.attended ? '✅' : '⏳'}
                    </div>
                    <div className="timeline-content">
                      <p className="timeline-date">
                        {new Date(evt.date).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric'
                        })}
                      </p>
                      <p className="timeline-title">{evt.title}</p>
                      <p className="timeline-role">
                        {evt.role === 'organizer' ? 'Organizer' : 'Volunteer'}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="no-timeline">
              <p>No activity to display</p>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
};

export default MemberActivityDetailPage;
