/\*\*

- TESTING GUIDE - Complete Backend Implementation
-
- This file demonstrates working code examples and testing procedures
- for the Sharda CRM backend API.
-
- Prerequisites:
- 1.  MongoDB running locally or connection to MongoDB Atlas
- 2.  Backend server running (npm run dev or npm start)
- 3.  Postman or similar REST client (or use cURL commands below)
      \*/

// =============================================
// 1. SETUP AND CONFIGURATION
// =============================================

// Environment variables (in .env file):
// MONGO_URI=mongodb://localhost:27017/shardacrm
// JWT_SECRET=your_secret_key_here
// JWT_REFRESH_SECRET=your_refresh_secret
// PORT=5000
// NODE_ENV=development

// =============================================
// 2. API TESTING WORKFLOW
// =============================================

/\*\*

- STEP 1: Register a new user
-
- URL: POST http://localhost:5000/api/v1/auth/register
-
- Request Body:
  \*/
  const registerPayload = {
  name: "Admin User",
  email: "admin@sharda.com",
  password: "admin@123",
  phone: "9999999999",
  companyName: "Sharda Corp"
  };

// cURL:
// curl -X POST http://localhost:5000/api/v1/auth/register \
// -H "Content-Type: application/json" \
// -d '{"name":"Admin User","email":"admin@sharda.com","password":"admin@123","phone":"9999999999","companyName":"Sharda Corp"}'

/\*\*

- Response (201 Created):
  \*/
  const registerResponse = {
  success: true,
  data: {
  user: {
  \_id: "507f1f77bcf86cd799439011",
  name: "Admin User",
  email: "admin@sharda.com",
  phone: "9999999999",
  role: "admin",
  organization: "507f1f77bcf86cd799439012",
  createdAt: "2024-01-15T10:00:00Z"
  },
  accessToken: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  refreshToken: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  },
  message: "User registered successfully"
  };

// =============================================
// STEP 2: Login existing user
// =============================================

const loginPayload = {
email: "admin@sharda.com",
password: "admin@123"
};

// cURL:
// curl -X POST http://localhost:5000/api/v1/auth/login \
// -H "Content-Type: application/json" \
// -d '{"email":"admin@sharda.com","password":"admin@123"}'

/\*\*

- Response (200 OK):
- Same structure as registerResponse
  \*/

// =============================================
// STEP 3: Create a lead
// =============================================

const leadPayload = {
name: "John Smith",
phone: "9876543210",
email: "john@example.com",
city: "Mumbai",
source: "Direct",
status: "New",
dealValue: 100000,
priority: "High"
};

// cURL:
// curl -X POST http://localhost:5000/api/v1/leads \
// -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
// -H "Content-Type: application/json" \
// -d '{"name":"John Smith","phone":"9876543210","email":"john@example.com","city":"Mumbai","source":"Direct","status":"New","dealValue":100000,"priority":"High"}'

/\*\*

- Response (201 Created):
  \*/
  const leadResponse = {
  success: true,
  data: {
  \_id: "507f1f77bcf86cd799439013",
  name: "John Smith",
  phone: "9876543210",
  email: "john@example.com",
  city: "Mumbai",
  source: "Direct",
  status: "New",
  dealValue: 100000,
  priority: "High",
  assignedTo: null,
  coAssignees: [],
  organization: "507f1f77bcf86cd799439012",
  createdAt: "2024-01-15T10:05:00Z",
  updatedAt: "2024-01-15T10:05:00Z"
  },
  message: "Lead created successfully"
  };

// =============================================
// STEP 4: Get all leads with filters
// =============================================

// cURL:
// curl -X GET "http://localhost:5000/api/v1/leads?page=1&limit=10&status=New&search=john" \
// -H "Authorization: Bearer YOUR_ACCESS_TOKEN"

/\*\*

- Response (200 OK):
  \*/
  const leadsListResponse = {
  success: true,
  data: {
  items: [
  {
  _id: "507f1f77bcf86cd799439013",
  name: "John Smith",
  phone: "9876543210",
  email: "john@example.com",
  status: "New",
  dealValue: 100000,
  assignedTo: {
  _id: "507f1f77bcf86cd799439011",
  name: "Admin User",
  email: "admin@sharda.com"
  },
  organization: "507f1f77bcf86cd799439012",
  createdAt: "2024-01-15T10:05:00Z"
  }
  ],
  pagination: {
  total: 1,
  page: 1,
  limit: 10,
  pages: 1,
  hasNext: false,
  hasPrev: false
  }
  },
  message: "Leads fetched successfully"
  };

// =============================================
// STEP 5: Update lead status
// =============================================

const updateStatusPayload = {
status: "Interested"
};

// cURL:
// curl -X PATCH http://localhost:5000/api/v1/leads/507f1f77bcf86cd799439013/status \
// -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
// -H "Content-Type: application/json" \
// -d '{"status":"Interested"}'

// =============================================
// STEP 6: Log activity (call, note, etc.)
// =============================================

const activityPayload = {
leadId: "507f1f77bcf86cd799439013",
type: "call",
text: "Called John, discussed requirements",
callDuration: 600,
callDirection: "outbound",
callOutcome: "Positive"
};

// cURL:
// curl -X POST http://localhost:5000/api/v1/activities \
// -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
// -H "Content-Type: application/json" \
// -d '{"leadId":"507f1f77bcf86cd799439013","type":"call","text":"Called John...","callDuration":600,"callDirection":"outbound","callOutcome":"Positive"}'

const activityResponse = {
success: true,
data: {
\_id: "507f1f77bcf86cd799439014",
leadId: "507f1f77bcf86cd799439013",
type: "call",
text: "Called John, discussed requirements",
callDuration: 600,
callDirection: "outbound",
callOutcome: "Positive",
createdBy: {
\_id: "507f1f77bcf86cd799439011",
name: "Admin User",
email: "admin@sharda.com"
},
organization: "507f1f77bcf86cd799439012",
createdAt: "2024-01-15T10:10:00Z"
},
message: "Activity logged successfully"
};

// =============================================
// STEP 7: Record payment
// =============================================

const paymentPayload = {
leadId: "507f1f77bcf86cd799439013",
amount: 50000,
currency: "INR",
paymentMode: "UPI",
status: "Completed",
reference: "UPI123456",
paymentDate: "2024-01-15T10:00:00Z",
description: "Advance payment received"
};

// cURL:
// curl -X POST http://localhost:5000/api/v1/payments \
// -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
// -H "Content-Type: application/json" \
// -d '{"leadId":"507f1f77bcf86cd799439013","amount":50000,"currency":"INR","paymentMode":"UPI","status":"Completed","reference":"UPI123456"}'

// =============================================
// STEP 8: Create reminder
// =============================================

const reminderPayload = {
leadId: "507f1f77bcf86cd799439013",
type: "follow-up",
reminderDate: "2024-01-20",
reminderTime: "10:30",
note: "Follow up on payment and next steps"
};

// cURL:
// curl -X POST http://localhost:5000/api/v1/reminders \
// -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
// -H "Content-Type: application/json" \
// -d '{"leadId":"507f1f77bcf86cd799439013","type":"follow-up","reminderDate":"2024-01-20","reminderTime":"10:30","note":"Follow up on payment and next steps"}'

// =============================================
// STEP 9: Create team member (Admin only)
// =============================================

const teamMemberPayload = {
name: "Jane Executive",
email: "jane@sharda.com",
password: "jane@123",
phone: "9876543211",
role: "exec"
};

// cURL:
// curl -X POST http://localhost:5000/api/v1/users \
// -H "Authorization: Bearer ADMIN_ACCESS_TOKEN" \
// -H "Content-Type: application/json" \
// -d '{"name":"Jane Executive","email":"jane@sharda.com","password":"jane@123","phone":"9876543211","role":"exec"}'

// =============================================
// STEP 10: Assign lead to user
// =============================================

const assignPayload = {
assignedTo: "507f1f77bcf86cd799439015" // ID of team member
};

// cURL:
// curl -X PATCH http://localhost:5000/api/v1/leads/507f1f77bcf86cd799439013/assign \
// -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
// -H "Content-Type: application/json" \
// -d '{"assignedTo":"507f1f77bcf86cd799439015"}'

// =============================================
// 3. COMPLETE TEST SEQUENCE
// =============================================

/\*\*

- Run this sequence to test the entire backend:
-
- 1.  POST /api/v1/auth/register → Get accessToken
- 2.  POST /api/v1/leads → Create lead (save leadId)
- 3.  GET /api/v1/leads → List all leads
- 4.  GET /api/v1/leads/:id → Get single lead
- 5.  PATCH /api/v1/leads/:id/status → Update lead status
- 6.  POST /api/v1/activities → Log activity
- 7.  GET /api/v1/activities/lead/:leadId → Get lead activities
- 8.  POST /api/v1/payments → Record payment
- 9.  GET /api/v1/payments → Get all payments
- 10. POST /api/v1/reminders → Create reminder
- 11. GET /api/v1/reminders → Get reminders
- 12. POST /api/v1/users → Create team member (needs admin)
- 13. PATCH /api/v1/leads/:id/assign → Assign lead
- 14. POST /api/v1/notifications → Create notification
- 15. GET /api/v1/notifications → Get notifications
      \*/

// =============================================
// 4. ERROR HANDLING EXAMPLES
// =============================================

/\*\*

- Validation Error (400 Bad Request):
  \*/
  const validationError = {
  success: false,
  statusCode: 400,
  errors: ["Validation error: \"name\" is required"],
  message: "Request failed"
  };

/\*\*

- Unauthorized Error (401):
  \*/
  const unauthorizedError = {
  success: false,
  statusCode: 401,
  errors: ["Invalid or expired token"],
  message: "Unauthorized"
  };

/\*\*

- Permission Error (403):
  \*/
  const permissionError = {
  success: false,
  statusCode: 403,
  errors: ["Not authorized to perform this action"],
  message: "Forbidden"
  };

/\*\*

- Not Found Error (404):
  \*/
  const notFoundError = {
  success: false,
  statusCode: 404,
  errors: ["Lead not found"],
  message: "Resource not found"
  };

// =============================================
// 5. DEMO CREDENTIALS
// =============================================

/\*\*

- Use these credentials to test immediately after setup:
-
- Email: admin@sharda.com
- Password: admin@123
-
- These are created during initial seed (if seed script is run)
  \*/

// =============================================
// 6. NODE.JS CLIENT EXAMPLE
// =============================================

/\*\*

- Using Axios/Fetch to interact with API:
  \*/

// Example function to create lead (JavaScript/Node.js)
const exampleCreateLead = async (accessToken) => {
try {
const response = await fetch('http://localhost:5000/api/v1/leads', {
method: 'POST',
headers: {
'Authorization': `Bearer ${accessToken}`,
'Content-Type': 'application/json'
},
body: JSON.stringify({
name: 'Test Lead',
phone: '9876543210',
email: 'test@example.com',
city: 'Mumbai',
source: 'Direct',
dealValue: 100000
})
});

    const data = await response.json();
    if (data.success) {
      console.log('Lead created:', data.data);
      return data.data;
    } else {
      console.error('Error:', data.errors);
    }

} catch (error) {
console.error('Request failed:', error);
}
};

// =============================================
// 7. VALIDATION RULES
// =============================================

/\*\*

- Lead Validation:
- - name: required, 2-100 chars
- - phone: required, 10+ digits with +, -, (), spaces
- - email: optional, valid email format
- - source: optional, enum values only
- - status: optional, must be valid status
- - dealValue: optional, must be >= 0
- - priority: optional, must be Low/Medium/High
    \*/

/\*\*

- User Validation:
- - name: required, 2-50 chars
- - email: required, valid email, unique per organization
- - password: required, 6-30 chars
- - phone: optional, must be 10 digits
- - role: optional, must be valid role
    \*/

/\*\*

- Activity Validation:
- - leadId: required, must exist
- - type: required, must be valid type (call, note, email, meeting, task, recording)
- - text: optional
- - callDuration: optional, must be >= 0
    \*/

/\*\*

- Payment Validation:
- - leadId: required, must exist
- - amount: required, must be >= 0
- - paymentMode: required, must be valid mode
- - status: optional, must be valid status
    \*/

/\*\*

- Reminder Validation:
- - leadId: required, must exist
- - type: required, must be valid type
- - reminderDate: required, valid date
- - reminderTime: required, HH:MM format
    \*/

// =============================================
// 8. RUNNING THE BACKEND
// =============================================

/\*\*

- Development:
- npm install
- npm run dev
-
- Production:
- npm start
-
- The server will start on http://localhost:5000
- Health check: GET http://localhost:5000/api/v1/health
-
- Expected response:
- {
- "status": "OK",
- "timestamp": "2024-01-15T10:00:00.000Z"
- }
  \*/

// =============================================
// END OF TESTING GUIDE
// =============================================

export {
registerPayload,
loginPayload,
leadPayload,
activityPayload,
paymentPayload,
reminderPayload,
teamMemberPayload,
assignPayload,
exampleCreateLead
};
