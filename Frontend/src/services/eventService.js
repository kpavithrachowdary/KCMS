import api from './api';

const eventService = {
  // Create Event
  create: async (formData) => {
    const response = await api.post('/events', formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    });
    return response.data;
  },

  // List Events
  list: async (params = {}) => {
    const response = await api.get('/events', { params });
    return response.data;
  },

  // Get Event Details
  getById: async (id, params = {}) => {
    // ✅ Support cache-busting with params (e.g., { _t: Date.now() })
    const response = await api.get(`/events/${id}`, { params });
    return response.data;
  },

  // Change Status
  // action: 'submit' | 'approve' | 'reject' | 'publish' | 'start' | 'complete'
  // extraData: { reason } - required for 'reject' action
  changeStatus: async (id, action, extraData = {}) => {
    const response = await api.patch(`/events/${id}/status`, { action, ...extraData });
    return response.data;
  },

  // RSVP
  rsvp: async (id) => {
    const response = await api.post(`/events/${id}/rsvp`);
    return response.data;
  },

  // Mark Attendance (QR code scanning)
  markAttendance: async (id, data) => {
    const response = await api.post(`/events/${id}/attendance`, data);
    return response.data;
  },

  // Update Organizer Attendance (bulk update for club members)
  updateOrganizerAttendance: async (id, attendance) => {
    const response = await api.post(`/events/${id}/organizer-attendance`, attendance);
    return response.data;
  },

  // Create Budget Request
  createBudget: async (id, data) => {
    const response = await api.post(`/events/${id}/budget`, data);
    return response.data;
  },

  // List Budgets
  listBudgets: async (id) => {
    const response = await api.get(`/events/${id}/budget`);
    return response.data;
  },

  // Settle Budget
  settleBudget: async (id, data) => {
    const response = await api.post(`/events/${id}/budget/settle`, data);
    return response.data;
  },

  // Update Event (only draft events can be edited)
  update: async (id, formData) => {
    const response = await api.patch(`/events/${id}`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    });
    return response.data;
  },

  // Delete Event (only draft events can be deleted)
  delete: async (id) => {
    const response = await api.delete(`/events/${id}`);
    return response.data;
  },

  // NOTE: Budget approval is handled via BudgetRequest status updates in Backend
  // There is no separate endpoint for approveBudget - removed as it called non-existent route

  // NOTE: Post-event report submission endpoint doesn't exist in Backend
  // Removed submitReport() method - endpoint needs to be implemented in Backend first

  // Upload Completion Materials (Photos, Report, Attendance, Bills)
  uploadMaterials: async (id, formData) => {
    const response = await api.post(`/events/${id}/upload-materials`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    });
    return response.data;
  },

  // Get Event Organizers (club members working at event)
  getEventOrganizers: async (id) => {
    const response = await api.get(`/events/${id}/organizers`);
    return response.data;
  },

  // Update Organizer Attendance (bulk update)
  updateOrganizerAttendance: async (id, attendanceData) => {
    const response = await api.post(`/events/${id}/organizer-attendance`, attendanceData);
    return response.data;
  },

  // Generate Attendance Report (JSON or CSV)
  generateAttendanceReport: async (id, format = 'json') => {
    const response = await api.get(`/events/${id}/attendance-report`, {
      params: { format },
      responseType: format === 'csv' ? 'blob' : 'json'
    });
    return response;
  },
};

export default eventService;
