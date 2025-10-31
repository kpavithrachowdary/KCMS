import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import Layout from '../../components/Layout';
import CompletionChecklist from '../../components/event/CompletionChecklist';
import eventService from '../../services/eventService';
import { ROLE_DISPLAY_NAMES, hasCoreMemberRole, CORE_AND_LEADERSHIP } from '../../utils/roleConstants';
import '../../styles/Events.css';

const EventDetailPage = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const uploadType = searchParams.get('upload'); // e.g., 'report', 'attendance', 'bills'
  
  const { user, clubMemberships } = useAuth();
  const [event, setEvent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [rsvpLoading, setRsvpLoading] = useState(false);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    fetchEventDetails();
  }, [id]);

  const fetchEventDetails = async () => {
    try {
      console.log('🔄 Fetching event details (cache-busted)...');
      
      // ✅ Add cache-busting timestamp to force fresh data
      const response = await eventService.getById(id, { _t: Date.now() });
      
      // ✅ FIX: Axios returns full response object
      // Structure: response.data = { status, data: { event } }
      const eventData = response.data?.data?.event || response.data?.event;
      
      console.log('📋 Fresh event data:', {
        status: eventData?.status,
        reportUrl: eventData?.reportUrl,
        reportUploaded: eventData?.completionChecklist?.reportUploaded
      });
      
      console.log('📋 EventDetailPage - Event data:', eventData);
      console.log('🤝 EventDetailPage - Participating clubs:', eventData?.participatingClubs);
      
      if (!eventData) {
        setEvent(null);
      } else {
        setEvent(eventData);
      }
    } catch (error) {
      console.error('❌ Error fetching event details:', error);
      console.error('Error response:', error.response);
      setEvent(null);
    } finally {
      setLoading(false);
    }
  };

  const handleRSVP = async () => {
    // Prevent multiple clicks
    if (rsvpLoading) return;
    
    setRsvpLoading(true);
    try {
      await eventService.rsvp(id);
      alert('RSVP successful!');
      await fetchEventDetails();
    } catch (error) {
      alert(error.response?.data?.message || 'Failed to RSVP');
    } finally {
      setRsvpLoading(false);
    }
  };

  const handleSubmitForApproval = async () => {
    if (!window.confirm('Submit this event for coordinator approval?')) return;
    
    try {
      await eventService.changeStatus(id, 'submit');
      alert('Event submitted for approval!');
      fetchEventDetails();
    } catch (error) {
      alert(error.response?.data?.message || 'Failed to submit event');
    }
  };

  const handleApproveEvent = async () => {
    if (!window.confirm('Approve this event?')) return;
    
    try {
      await eventService.changeStatus(id, 'approve');
      alert('Event approved successfully!');
      fetchEventDetails();
    } catch (error) {
      alert(error.response?.data?.message || 'Failed to approve event');
    }
  };

  const handleAdminApprove = async () => {
    if (!window.confirm('Approve this event as Admin?')) return;
    
    try {
      await eventService.changeStatus(id, 'approve'); // ✅ Use 'approve' not 'approveAdmin'
      alert('Event approved by Admin successfully!');
      fetchEventDetails();
    } catch (error) {
      alert(error.response?.data?.message || 'Failed to approve event');
    }
  };

  const handleEdit = () => {
    navigate(`/events/${id}/edit`);
  };

  const handleDelete = async () => {
    // ✅ Prevent deletion of non-draft events
    if (event?.status !== 'draft') {
      alert(`Cannot delete event with status '${event?.status}'. Only draft events can be deleted.`);
      return;
    }

    if (!window.confirm(`Are you sure you want to delete "${event?.title}"?\n\nThis action cannot be undone.`)) {
      return;
    }
    
    setLoading(true);
    try {
      await eventService.delete(id);
      alert('✅ Event deleted successfully!');
      navigate('/events');
    } catch (error) {
      console.error('Delete error:', error);
      const errorMsg = error.response?.data?.message || error.message || 'Failed to delete event';
      alert(`❌ ${errorMsg}`);
      setLoading(false);
    }
  };


  if (loading) {
    return (
      <Layout>
        <div className="loading-container">
          <div className="spinner"></div>
          <p>Loading event details...</p>
        </div>
      </Layout>
    );
  }

  if (!event) {
    return (
      <Layout>
        <div className="error-container">
          <h2>Event not found</h2>
          <button onClick={() => navigate('/events')} className="btn btn-primary">
            Back to Events
          </button>
        </div>
      </Layout>
    );
  }

  // ✅ Multi-layered permission check
  // Check 1: Backend-provided canManage flag
  const backendCanManage = event?.canManage || false;
  
  // Check 2: Is coordinator assigned to THIS event's club
  const coordinatorId = event?.club?.coordinator?._id || event?.club?.coordinator;
  const userId = user?._id?.toString() || user?._id;
  const isCoordinatorForClub = user?.roles?.global === 'coordinator' && 
                                coordinatorId?.toString() === userId;
  
  // Check 3: Is admin
  const isAdmin = user?.roles?.global === 'admin';
  
  // Check 4: Has club management role (president, vicePresident, core team)
  const clubId = event?.club?._id?.toString() || event?.club?.toString();
  const hasClubManagementRole = clubMemberships ? 
    clubMemberships.some(membership => {
      const memberClubId = membership.club?._id?.toString() || membership.club?.toString();
      return memberClubId === clubId && CORE_AND_LEADERSHIP.includes(membership.role);
    }) : false;
  
  // ✅ FINAL PERMISSION: User can manage if ANY of these conditions are true
  const canManage = backendCanManage || isCoordinatorForClub || isAdmin || hasClubManagementRole;

  const isPublished = event?.status === 'published';
  
  // ✅ Check if user has already RSVP'd
  const hasRSVPd = event?.attendees?.some(attendee => {
    const attendeeId = attendee?._id?.toString() || attendee?.toString();
    const currentUserId = user?._id?.toString();
    return attendeeId === currentUserId;
  }) || false;

  // Handle material upload
  const handleMaterialUpload = async (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;

    setUploading(true);
    try {
      const formData = new FormData();
      files.forEach(file => {
        formData.append(uploadType, file);
      });

      await eventService.uploadMaterials(event._id, formData);
      alert('✅ Upload successful!');
      
      // Reload event data and clear upload param
      await fetchEventDetails();
      searchParams.delete('upload');
      setSearchParams(searchParams);
    } catch (err) {
      console.error('Upload error:', err);
      alert(`❌ Upload failed: ${err.response?.data?.message || err.message}`);
    } finally {
      setUploading(false);
    }
  };

  const getUploadConfig = (type) => {
    const configs = {
      report: { label: 'Event Report', accept: '.pdf,.doc,.docx', icon: '📄', multiple: false },
      attendance: { label: 'Attendance Sheet', accept: '.xlsx,.xls,.csv', icon: '📊', multiple: false },
      bills: { label: 'Bills/Receipts', accept: '.pdf,image/*', icon: '🧾', multiple: true }
    };
    return configs[type] || configs.report;
  };

  return (
    <Layout>
      <div className="event-detail-page">
        <div className="event-detail-header">
          <div className="event-date-large">
            <span className="day">{event?.dateTime ? new Date(event.dateTime).getDate() : '--'}</span>
            <span className="month">
              {event?.dateTime ? new Date(event.dateTime).toLocaleString('default', { month: 'short' }) : '--'}
            </span>
            <span className="year">{event?.dateTime ? new Date(event.dateTime).getFullYear() : '--'}</span>
          </div>

          <div className="event-header-info">
            <div className="event-title-row">
              <h1>{event?.title || 'Event Details'}</h1>
              <span className={`badge badge-lg badge-${
                event?.status === 'draft' ? 'secondary' :
                event?.status === 'pending_coordinator' ? 'warning' :
                event?.status === 'pending_admin' ? 'warning' :
                event?.status === 'approved' ? 'info' :
                event?.status === 'published' ? 'success' : 
                event?.status === 'ongoing' ? 'info' : 
                event?.status === 'pending_completion' ? 'warning' :
                event?.status === 'completed' ? 'success' :
                event?.status === 'cancelled' ? 'danger' : 'warning'
              }`}>
                {event?.status === 'pending_completion' ? '⏳ PENDING COMPLETION' :
                 event?.status?.replace('_', ' ').toUpperCase() || 'N/A'}
              </span>
            </div>
            <p className="event-club-large">
              Organized by <strong>{event?.club?.name || 'Unknown Club'}</strong>
              {event?.participatingClubs && event.participatingClubs.length > 0 && (
                <span className="participating-clubs">
                  {' '}in collaboration with{' '}
                  <strong>{event.participatingClubs.map(c => c.name).join(', ')}</strong>
                </span>
              )}
            </p>
            <p className="event-description-large">{event?.description || 'No description available'}</p>

            <div className="event-meta-large">
              <div className="meta-item">
                <span className="meta-icon">📍</span>
                <span>{event?.venue || 'TBD'} (Capacity: {event?.capacity || 'N/A'})</span>
              </div>
              <div className="meta-item">
                <span className="meta-icon">🕐</span>
                <span>
                  {event?.dateTime ? new Date(event.dateTime).toLocaleString('en-US', { 
                    weekday: 'long',
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                  }) : 'Date TBD'}
                </span>
              </div>
              <div className="meta-item">
                <span className="meta-icon">⏱️</span>
                <span>Duration: {event?.duration || 'TBD'} hours</span>
              </div>
              <div className="meta-item">
                <span className="meta-icon">👥</span>
                <span>{event?.expectedAttendees || 'N/A'} expected attendees</span>
              </div>
              {canManage && (
                <div className="meta-item">
                  <span className="meta-icon">✅</span>
                  <span><strong>{event?.rsvpCount || 0} RSVPs received</strong> (approved registrations)</span>
                </div>
              )}
            </div>

            <div className="event-actions">
              {/* ✅ Event Registration - Only for students */}
              {isPublished && !event.hasRegistered && user?.roles?.global === 'student' && (
                <button 
                  onClick={() => navigate(`/events/${id}/register`)}
                  className="btn btn-primary"
                >
                  📝 Register for Event
                </button>
              )}
              
              {/* ✅ Show "Already Registered" if user has registered */}
              {isPublished && event.hasRegistered && user?.roles?.global === 'student' && (
                <button 
                  className="btn btn-success"
                  disabled
                  style={{ cursor: 'not-allowed', opacity: 0.7 }}
                >
                  ✅ Already Registered
                </button>
              )}
              
              {/* Club Core/President actions */}
              {canManage && event?.status === 'draft' && (
                <>
                  <button 
                    onClick={handleEdit}
                    className="btn btn-secondary"
                  >
                    ✏️ Edit Event
                  </button>
                  <button 
                    onClick={handleDelete}
                    className="btn btn-danger"
                  >
                    🗑️ Delete Event
                  </button>
                  <button 
                    onClick={handleSubmitForApproval}
                    className="btn btn-primary"
                  >
                    Submit for Approval
                  </button>
                </>
              )}
              
              {/* Coordinator approval button */}
              {isCoordinatorForClub && event?.status === 'pending_coordinator' && (
                <button 
                  onClick={handleApproveEvent}
                  className="btn btn-success"
                >
                  ✓ Approve Event
                </button>
              )}

              
              {user?.roles?.global === 'admin' && event?.status === 'pending_admin' && (
                <button 
                  onClick={handleAdminApprove}
                  className="btn btn-success"
                >
                  ✓ Approve as Admin
                </button>
              )}
              
              {/* Status transition buttons for ongoing events */}
              {canManage && event?.status === 'published' && (
                <button 
                  onClick={async () => {
                    try {
                      await eventService.changeStatus(id, 'start');
                      alert('Event started!');
                      fetchEventDetails();
                    } catch (err) {
                      alert(err.response?.data?.message || 'Failed to start event');
                    }
                  }}
                  className="btn btn-primary"
                >
                  Start Event
                </button>
              )}
              
              {canManage && event?.status === 'ongoing' && (
                <button 
                  onClick={async () => {
                    try {
                      await eventService.changeStatus(id, 'complete');
                      alert('Event completed!');
                      fetchEventDetails();
                    } catch (err) {
                      alert(err.response?.data?.message || 'Failed to complete event');
                    }
                  }}
                  className="btn btn-success"
                >
                  Complete Event
                </button>
              )}
            </div>
          </div>
        </div>

        {/* ✅ Upload Section - Shows when ?upload=report/attendance/bills query param is present */}
        {uploadType && canManage && (
          <div className="info-card" style={{ marginBottom: '2rem', background: '#f0f9ff', borderLeft: '4px solid #3b82f6' }}>
            <div className="section-header">
              <h3>{getUploadConfig(uploadType).icon} Upload {getUploadConfig(uploadType).label}</h3>
              <button 
                onClick={() => {
                  searchParams.delete('upload');
                  setSearchParams(searchParams);
                }}
                className="btn btn-sm btn-outline"
                style={{ marginLeft: 'auto' }}
              >
                ✕ Close
              </button>
            </div>
            
            <div style={{ padding: '1.5rem', background: 'white', borderRadius: '8px', margin: '1rem 0' }}>
              <p style={{ marginBottom: '1rem', color: '#64748b' }}>
                Select your {getUploadConfig(uploadType).label.toLowerCase()} file to upload.
                {getUploadConfig(uploadType).multiple && ' You can select multiple files.'}
              </p>
              
              <input
                type="file"
                accept={getUploadConfig(uploadType).accept}
                multiple={getUploadConfig(uploadType).multiple}
                onChange={handleMaterialUpload}
                disabled={uploading}
                style={{
                  padding: '0.75rem',
                  border: '2px dashed #cbd5e1',
                  borderRadius: '8px',
                  width: '100%',
                  cursor: 'pointer',
                  background: '#f8fafc'
                }}
              />
              
              {uploading && (
                <p style={{ marginTop: '1rem', color: '#3b82f6', fontWeight: '500' }}>
                  ⏳ Uploading... Please wait.
                </p>
              )}
              
              <div style={{ marginTop: '1rem', fontSize: '0.875rem', color: '#64748b' }}>
                <strong>Accepted formats:</strong> {getUploadConfig(uploadType).accept.split(',').join(', ')}
              </div>
            </div>
          </div>
        )}

        {/* Completion Checklist - Shows for pending_completion and completed events (allow re-uploads) */}
        {(event?.status === 'pending_completion' || event?.status === 'completed') && (
          <CompletionChecklist 
            event={event} 
            canManage={canManage}
            onUploadComplete={() => fetchEventDetails()}
          />
        )}

        {/* ✅ Event Registrations Management - Hide for completed events */}
        {canManage && 
         event?.status !== 'draft' && 
         event?.status !== 'pending_completion' && 
         event?.status !== 'completed' && (
          <div className="info-card" style={{ marginBottom: '2rem' }}>
            <div className="section-header">
              <h3>📝 Event Registrations</h3>
              <p className="section-subtitle">Manage audience and performer registrations</p>
            </div>
            
            <div className="registration-stats" style={{ 
              display: 'grid', 
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', 
              gap: '1rem', 
              margin: '1.5rem 0' 
            }}>
              <div className="stat-item" style={{ 
                padding: '1rem', 
                background: '#f8fafc', 
                borderRadius: '8px',
                border: '1px solid #e2e8f0'
              }}>
                <div style={{ fontSize: '0.875rem', color: '#64748b', marginBottom: '0.5rem' }}>
                  Total Registrations
                </div>
                <div style={{ fontSize: '1.875rem', fontWeight: '600', color: '#1e293b' }}>
                  {event.registrationCount || 0}
                </div>
              </div>
              <div className="stat-item" style={{ 
                padding: '1rem', 
                background: '#fef3c7', 
                borderRadius: '8px',
                border: '1px solid #fbbf24'
              }}>
                <div style={{ fontSize: '0.875rem', color: '#92400e', marginBottom: '0.5rem' }}>
                  Pending Approval
                </div>
                <div style={{ fontSize: '1.875rem', fontWeight: '600', color: '#92400e' }}>
                  {event.pendingRegistrations || 0}
                </div>
              </div>
            </div>
            
            <button 
              onClick={() => navigate(`/events/${event._id}/registrations/manage`)}
              className="btn btn-primary"
              style={{ width: '100%' }}
            >
              📋 View & Manage Registrations
            </button>
          </div>
        )}

        {/* ✅ Club Member Attendance Section - For Ongoing and Published Events */}
        {canManage && (event?.status === 'ongoing' || event?.status === 'published') && (
          <div className="attendance-section">
            <div className="section-header">
              <h2>👥 Club Member Attendance</h2>
              <p className="section-subtitle">Track attendance of all club members from participating clubs</p>
            </div>
            
            <div className="attendance-info">
              <p>All members from <strong>{event?.club?.name}</strong>
              {event?.participatingClubs && event.participatingClubs.length > 0 && (
                <span> and {event.participatingClubs.map(c => c.name).join(', ')}</span>
              )} are automatically tracked for attendance.</p>
            </div>
            
            <div className="attendance-actions">
              <button 
                onClick={() => navigate(`/events/${id}/organizer-attendance`)}
                className="btn btn-primary"
              >
                📝 Manage Club Member Attendance
              </button>
            </div>
          </div>
        )}

        {/* Completed Event Reports */}
        {canManage && event?.status === 'completed' && (
          <div className="completed-event-section">
            <h2>📊 Event Reports & Analytics</h2>
            <div className="report-actions">
              <button 
                onClick={() => navigate(`/events/${id}/organizer-attendance`)}
                className="btn btn-secondary"
              >
                📋 View Organizer Attendance
              </button>
              <button 
                onClick={() => {
                  console.log('🔍 DEBUG - Download Report Button Clicked');
                  console.log('📄 event.reportUrl:', event?.reportUrl);
                  console.log('📄 reportUrl type:', typeof event?.reportUrl);
                  
                  if (event?.reportUrl) {
                    console.log('✅ Opening URL:', event.reportUrl);
                    
                    // Check if it's a Cloudinary URL or local path
                    if (event.reportUrl.startsWith('http://') || event.reportUrl.startsWith('https://')) {
                      console.log('✅ Valid HTTP/HTTPS URL - opening in new tab');
                      window.open(event.reportUrl, '_blank');
                    } else {
                      console.error('❌ Invalid URL format (not HTTP/HTTPS):', event.reportUrl);
                      alert(`❌ Invalid file URL format: ${event.reportUrl}\n\nThis appears to be a local path. The file needs to be re-uploaded to Cloudinary.`);
                    }
                  } else {
                    console.log('❌ No reportUrl found');
                    alert('❌ No event report uploaded yet. Please upload the report in the completion checklist.');
                  }
                }}
                className="btn btn-outline"
                disabled={!event?.reportUrl}
                title={event?.reportUrl ? 'Download event report document' : 'No report uploaded yet'}
              >
                📄 Download Event Report
              </button>
            </div>
          </div>
        )}

        <div className="event-detail-content">
          <div className="info-card">
            <h3>Event Objectives</h3>
            <p>{event?.objectives || 'No objectives specified'}</p>
          </div>

          {event?.isPublic !== undefined && (
            <div className="info-card">
              <h3>Audience</h3>
              <p>{event?.isPublic ? 'Open to all students' : 'Members only'}</p>
            </div>
          )}

          {event?.budget && (
            <div className="info-card">
              <h3>Budget</h3>
              <p>₹{event?.budget}</p>
            </div>
          )}

          {event?.guestSpeakers && event?.guestSpeakers.length > 0 && (
            <div className="info-card">
              <h3>Guest Speakers</h3>
              <ul>
                {event.guestSpeakers.map((speaker, index) => (
                  <li key={index}>{speaker}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Old attendees list removed - use "View & Manage Registrations" page instead */}

        </div>
      </div>
    </Layout>
  );
};

export default EventDetailPage;
