import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../../components/Layout';
import notificationService from '../../services/notificationService';
import '../../styles/CreateNotification.css';

/**
 * Create Notification Page (Admin Only)
 * Backend Gap Implementation - Admin notification creation
 */
const CreateNotificationPage = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);

  const [formData, setFormData] = useState({
    type: 'system',
    priority: 'MEDIUM',
    title: '',
    message: '',
    targetUsers: 'all', // 'all', 'students', 'coordinators', 'admins', 'specific'
    specificUsers: '',
    link: '',
    expiresAt: ''
  });

  const notificationTypes = [
    { value: 'system', label: 'System', icon: '🔔' },
    { value: 'announcement', label: 'Announcement', icon: '⚠️' },
    { value: 'event', label: 'Event', icon: '📅' },
    { value: 'recruitment', label: 'Recruitment', icon: '👥' }
  ];

  const priorities = [
    { value: 'LOW', label: 'Low', color: 'bg-gray-100 text-gray-800' },
    { value: 'MEDIUM', label: 'Medium', color: 'bg-blue-100 text-blue-800' },
    { value: 'HIGH', label: 'High', color: 'bg-orange-100 text-orange-800' },
    { value: 'URGENT', label: 'Urgent', color: 'bg-red-100 text-red-800' }
  ];

  const targetAudiences = [
    { value: 'all', label: 'All Users' },
    { value: 'students', label: 'All Students' },
    { value: 'coordinators', label: 'All Coordinators' },
    { value: 'admins', label: 'All Admins' },
    { value: 'specific', label: 'Specific Users' }
  ];

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!formData.title || !formData.message) {
      setError('Title and message are required');
      return;
    }

    try {
      setLoading(true);
      setError(null);

      // Prepare data based on target audience
      const notificationData = {
        type: formData.type,
        priority: formData.priority,
        title: formData.title,
        message: formData.message,
        link: formData.link || undefined,
        expiresAt: formData.expiresAt || undefined
      };

      // Add target users if specific
      if (formData.targetUsers === 'specific' && formData.specificUsers) {
        notificationData.targetUsers = formData.specificUsers
          .split(',')
          .map(id => id.trim())
          .filter(id => id);
      } else {
        // For role-based targeting, backend will handle
        notificationData.targetRole = formData.targetUsers;
      }

      await notificationService.createNotification(notificationData);
      
      setSuccess(true);
      
      // Reset form after success
      setTimeout(() => {
        navigate('/admin/notifications');
      }, 2000);

    } catch (err) {
      setError(err.response?.data?.message || 'Failed to create notification');
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <Layout>
        <div className="success-container">
          <div className="success-card">
            <div className="success-icon">
              <span>📤</span>
            </div>
            <h2>Notification Sent!</h2>
            <p className="success-message">
              The notification has been created and sent to targeted users.
            </p>
            <p className="redirect-message">
              Redirecting...
            </p>
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="create-notification-page">
        <div className="page-container">
          {/* Header */}
          <div className="page-header">
            <button onClick={() => navigate(-1)} className="back-btn">
              ← Back
            </button>
            <h1>Create System Notification</h1>
            <p className="page-subtitle">
              Send notifications to users across the system
            </p>
          </div>

          {/* Error Message */}
          {error && (
            <div className="error-alert">
              <p>{error}</p>
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="notification-form">
            {/* Notification Type */}
            <div className="form-group">
              <label className="form-label">Notification Type</label>
              <div className="type-grid">
                {notificationTypes.map((type) => (
                  <button
                    key={type.value}
                    type="button"
                    onClick={() => setFormData(prev => ({ ...prev, type: type.value }))}
                    className={`type-btn ${formData.type === type.value ? 'active' : ''}`}
                  >
                    <span className="type-icon">{type.icon}</span>
                    <span className="type-label">{type.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Priority */}
            <div className="form-group">
              <label className="form-label">Priority</label>
              <div className="priority-grid">
                {priorities.map((priority) => (
                  <button
                    key={priority.value}
                    type="button"
                    onClick={() => setFormData(prev => ({ ...prev, priority: priority.value }))}
                    className={`priority-btn priority-${priority.value.toLowerCase()} ${
                      formData.priority === priority.value ? 'active' : ''
                    }`}
                  >
                    {priority.label}
                  </button>
                ))}
              </div>
              <p className="form-hint">
                URGENT notifications cannot be unsubscribed from
              </p>
            </div>

            {/* Title */}
            <div className="form-group">
              <label className="form-label">Title *</label>
              <input
                type="text"
                name="title"
                value={formData.title}
                onChange={handleChange}
                required
                placeholder="Enter notification title"
                className="form-input"
              />
            </div>

            {/* Message */}
            <div className="form-group">
              <label className="form-label">Message *</label>
              <textarea
                name="message"
                value={formData.message}
                onChange={handleChange}
                required
                rows="4"
                placeholder="Enter notification message"
                className="form-textarea"
              />
            </div>

            {/* Target Audience */}
            <div className="form-group">
              <label className="form-label">Target Audience</label>
              <select
                name="targetUsers"
                value={formData.targetUsers}
                onChange={handleChange}
                className="form-select"
              >
                {targetAudiences.map((audience) => (
                  <option key={audience.value} value={audience.value}>
                    {audience.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Specific Users (if selected) */}
            {formData.targetUsers === 'specific' && (
              <div className="form-group">
                <label className="form-label">User IDs (comma-separated)</label>
                <input
                  type="text"
                  name="specificUsers"
                  value={formData.specificUsers}
                  onChange={handleChange}
                  placeholder="e.g., 507f1f77bcf86cd799439011, 507f191e810c19729de860ea"
                  className="form-input"
                />
                <p className="form-hint">
                  Enter MongoDB ObjectIds separated by commas
                </p>
              </div>
            )}

            {/* Link (Optional) */}
            <div className="form-group">
              <label className="form-label">Action Link (Optional)</label>
              <input
                type="text"
                name="link"
                value={formData.link}
                onChange={handleChange}
                placeholder="/events/123 or https://example.com"
                className="form-input"
              />
              <p className="form-hint">
                Users will be redirected to this URL when clicking the notification
              </p>
            </div>

            {/* Expiration (Optional) */}
            <div className="form-group">
              <label className="form-label">Expires At (Optional)</label>
              <input
                type="datetime-local"
                name="expiresAt"
                value={formData.expiresAt}
                onChange={handleChange}
                className="form-input"
              />
              <p className="form-hint">
                Notification will be automatically removed after this date
              </p>
            </div>

            {/* Submit Button */}
            <div className="form-actions">
              <button
                type="button"
                onClick={() => navigate(-1)}
                className="btn btn-secondary"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading}
                className="btn btn-primary"
              >
                {loading ? (
                  <>
                    <span className="spinner"></span>
                    Sending...
                  </>
                ) : (
                  <>
                    <span>📤</span>
                    Send Notification
                  </>
                )}
              </button>
            </div>
          </form>

          {/* Info Box */}
          <div className="info-box">
            <div className="info-content">
              <span className="info-icon">🔔</span>
              <div className="info-text">
                <p className="info-title">About System Notifications</p>
                <ul>
                  <li>Notifications are sent immediately to all targeted users</li>
                  <li>Users will receive in-app and email notifications</li>
                  <li>URGENT notifications cannot be unsubscribed from</li>
                  <li>Non-URGENT notifications respect user preferences</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
};

export default CreateNotificationPage;
