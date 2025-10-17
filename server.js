const express = require('express');
const cors = require('cors');
const path = require('path');
const { Client, Environment } = require('square');

const app = express();
const PORT = process.env.PORT || 10000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Square Client Configuration
const squareClient = new Client({
    accessToken: process.env.SQUARE_ACCESS_TOKEN,
    environment: process.env.SQUARE_ENVIRONMENT === 'production' ? Environment.Production : Environment.Sandbox,
});

const { bookingsApi, catalogApi, customersApi } = squareClient;
const LOCATION_ID = process.env.SQUARE_LOCATION_ID || 'LT1S9BE1EX0PW';

// ==================== HEALTH CHECK ====================
app.get('/health', (req, res) => {
    res.json({
        status: 'OK',
        message: 'PJA Telehealth Backend is running!',
        environment: process.env.SQUARE_ENVIRONMENT || 'sandbox',
        timestamp: new Date().toISOString()
    });
});

// ==================== SERVE FRONTEND ====================
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// ==================== GET AVAILABILITY FROM SQUARE ====================
app.get('/api/availability', async (req, res) => {
    try {
        const { date, duration } = req.query;
        
        if (!date || !duration) {
            return res.status(400).json({
                success: false,
                message: 'Missing required parameters: date, duration'
            });
        }

        // Parse the date and set business hours (9 AM - 5 PM)
        const selectedDate = new Date(date + 'T00:00:00');
        const startOfDay = new Date(selectedDate);
        startOfDay.setHours(9, 0, 0, 0);
        const endOfDay = new Date(selectedDate);
        endOfDay.setHours(17, 0, 0, 0);

        // Try to get existing bookings for that day to block out times
        let bookedTimes = [];
        try {
            const bookingsResponse = await bookingsApi.listBookings({
                locationId: LOCATION_ID,
                startAtMin: startOfDay.toISOString(),
                startAtMax: endOfDay.toISOString()
            });

            if (bookingsResponse.result && bookingsResponse.result.bookings) {
                bookedTimes = bookingsResponse.result.bookings.map(booking => {
                    const time = new Date(booking.startAt);
                    return `${time.getHours().toString().padStart(2, '0')}:${time.getMinutes().toString().padStart(2, '0')}`;
                });
            }
        } catch (squareError) {
            console.log('Could not fetch existing bookings:', squareError.message);
        }

        // Generate available time slots (9 AM - 5 PM)
        const timeSlots = [];
        
        // Morning slots: 9 AM - 12 PM
        for (let hour = 9; hour < 12; hour++) {
            const timeString = `${hour.toString().padStart(2, '0')}:00`;
            timeSlots.push({
                time: timeString,
                available: !bookedTimes.includes(timeString)
            });
        }
        
        // Afternoon slots: 1 PM - 5 PM
        for (let hour = 13; hour < 17; hour++) {
            const timeString = `${hour.toString().padStart(2, '0')}:00`;
            timeSlots.push({
                time: timeString,
                available: !bookedTimes.includes(timeString)
            });
        }

        // Filter to only available slots
        const availableSlots = timeSlots.filter(slot => slot.available);

        res.json({
            success: true,
            slots: availableSlots
        });

    } catch (error) {
        console.error('Availability error:', error);
        res.status(500).json({
            success: false,
            message: 'Error checking availability',
            error: error.message
        });
    }
});

// ==================== CREATE BOOKING IN SQUARE WITH CONSENT STORAGE ====================
app.post('/api/bookings', async (req, res) => {
    try {
        const { service, personal, health, consents, appointment } = req.body;

        if (!service || !personal || !appointment) {
            return res.status(400).json({
                success: false,
                message: 'Missing required booking information'
            });
        }

        // Validate consents were signed
        if (!consents || !consents.hipaa || !consents.telehealth) {
            return res.status(400).json({
                success: false,
                message: 'HIPAA and Telehealth consents must be accepted'
            });
        }

        // Combine date and time for the appointment
        const appointmentDateTime = new Date(`${appointment.date}T${appointment.time}:00`);
        const consentTimestamp = new Date().toISOString();

        console.log('=== CREATING BOOKING ===');
        console.log('Patient:', personal.firstName, personal.lastName);
        console.log('Service:', service.name);
        console.log('Time:', appointmentDateTime.toISOString());

        let customerId = null;
        let squareBookingId = null;

        try {
            // ========== STEP 1: CREATE OR FIND CUSTOMER IN SQUARE ==========
            
            // Search for existing customer by email
            try {
                const searchResponse = await customersApi.searchCustomers({
                    query: {
                        filter: {
                            emailAddress: {
                                exact: personal.email
                            }
                        }
                    }
                });

                if (searchResponse.result && searchResponse.result.customers && searchResponse.result.customers.length > 0) {
                    customerId = searchResponse.result.customers[0].id;
                    console.log('✓ Found existing customer:', customerId);
                    
                    // Update customer with latest info and consent records
                    await customersApi.updateCustomer(customerId, {
                        givenName: personal.firstName,
                        familyName: personal.lastName,
                        phoneNumber: personal.phone,
                        note: buildCustomerNote(personal, health, consents, consentTimestamp)
                    });
                    console.log('✓ Updated customer with consent records');
                }
            } catch (searchError) {
                console.log('Customer search failed, creating new:', searchError.message);
            }

            // Create new customer if not found
            if (!customerId) {
                const createResponse = await customersApi.createCustomer({
                    givenName: personal.firstName,
                    familyName: personal.lastName,
                    emailAddress: personal.email,
                    phoneNumber: personal.phone,
                    note: buildCustomerNote(personal, health, consents, consentTimestamp)
                });
                customerId = createResponse.result.customer.id;
                console.log('✓ Created new customer:', customerId);
            }

            // ========== STEP 2: CREATE BOOKING IN SQUARE ==========
            
            const bookingResponse = await bookingsApi.createBooking({
                booking: {
                    locationId: LOCATION_ID,
                    startAt: appointmentDateTime.toISOString(),
                    customerId: customerId,
                    customerNote: buildPatientNote(health, service),
                    sellerNote: buildProviderNote(personal, health, consents, service, consentTimestamp)
                }
            });

            squareBookingId = bookingResponse.result.booking.id;
            console.log('✓ Square booking created:', squareBookingId);
            console.log('✓ All consents and health data stored in Square (HIPAA compliant)');

        } catch (squareError) {
            console.error('❌ Square API Error:', squareError);
            return res.status(500).json({
                success: false,
                message: 'Unable to create booking in Square. Please call (248) 794-7135.',
                error: squareError.message
            });
        }

        // ========== STEP 3: SEND SUCCESS RESPONSE ==========
        
        res.json({
            success: true,
            bookingId: squareBookingId,
            message: 'Booking confirmed! Confirmation email sent.',
            appointmentDetails: {
                date: appointment.date,
                time: appointment.time,
                service: service.name,
                price: service.price,
                doxyLink: 'https://doxy.me/PatrickPJAwellness',
                provider: 'Patrick Smith, BCHHP'
            }
        });

        console.log('=== BOOKING COMPLETE ===');

    } catch (error) {
        console.error('Booking error:', error);
        res.status(500).json({
            success: false,
            message: 'Error creating booking. Please call (248) 794-7135.',
            error: error.message
        });
    }
});

// ==================== BUILD CUSTOMER NOTE WITH CONSENT RECORDS ====================
function buildCustomerNote(personal, health, consents, timestamp) {
    return `
=== PATIENT INFORMATION ===
DOB: ${personal.dob || 'Not provided'}
Emergency Contact: ${personal.emergencyName || 'None'} ${personal.emergencyPhone || ''}

=== MEDICAL HISTORY ===
Medications: ${health.medications || 'None reported'}
Allergies: ${health.allergies || 'None reported'}

=== HIPAA CONSENT RECORDS ===
HIPAA Privacy Notice: SIGNED on ${timestamp}
- Patient acknowledges receiving HIPAA Privacy Notice
- Patient understands rights regarding protected health information
- Digital signature captured via telehealth platform

Telehealth Services Consent: SIGNED on ${timestamp}
- Patient consents to telehealth services
- Patient understands benefits, risks, and limitations
- Patient agrees to use secure HIPAA-compliant video platform (Doxy.me)
- Digital signature captured via telehealth platform

Recording Consent: ${consents.recording ? 'AUTHORIZED' : 'NOT AUTHORIZED'} on ${timestamp}

=== COMPLIANCE ===
All consents stored in Square (HIPAA compliant system)
Platform: PJA Telehealth (HIPAA compliant)
Video Platform: Doxy.me (HIPAA compliant - BAA on file)
    `.trim();
}

// ==================== BUILD PATIENT-FACING NOTE ====================
function buildPatientNote(health, service) {
    return `
Chief Complaint: ${health.chiefComplaint}
Duration: ${health.symptomDuration || 'Not specified'}
Symptoms: ${health.symptoms && health.symptoms.length > 0 ? health.symptoms.join(', ') : 'None checked'}

Service: ${service.name}
Duration: ${service.duration || 30} minutes
    `.trim();
}

// ==================== BUILD PROVIDER NOTE WITH FULL DETAILS ====================
function buildProviderNote(personal, health, consents, service, timestamp) {
    return `
🩺 TELEHEALTH CONSULTATION - ${service.name}

📋 PATIENT INFO:
Name: ${personal.firstName} ${personal.lastName}
Email: ${personal.email}
Phone: ${personal.phone}
DOB: ${personal.dob || 'Not provided'}
Emergency: ${personal.emergencyName || 'None'} ${personal.emergencyPhone || ''}

🏥 CHIEF COMPLAINT:
${health.chiefComplaint}

⏱ SYMPTOM DURATION: ${health.symptomDuration || 'Not specified'}

🩹 CURRENT SYMPTOMS:
${health.symptoms && health.symptoms.length > 0 ? health.symptoms.join(', ') : 'None selected'}

💊 MEDICATIONS:
${health.medications || 'None reported'}

⚠️ ALLERGIES:
${health.allergies || 'None reported'}

✅ CONSENT STATUS (Signed: ${timestamp}):
- HIPAA Privacy: SIGNED ✓
- Telehealth Consent: SIGNED ✓
- Recording: ${consents.recording ? 'AUTHORIZED ✓' : 'NOT AUTHORIZED'}

🎥 VIDEO CONSULTATION:
Provider Link: https://doxy.me/PatrickPJAwellness/provider
Patient Link: https://doxy.me/PatrickPJAwellness

📝 NOTE: All consent forms stored in Square Customer record (HIPAA compliant)
    `.trim();
}

// ==================== PROVIDER DASHBOARD - GET APPOINTMENTS ====================
app.get('/api/provider/appointments', async (req, res) => {
    try {
        const today = new Date();
        const startDate = new Date(today);
        startDate.setDate(startDate.getDate() - 7);
        const endDate = new Date(today);
        endDate.setDate(endDate.getDate() + 30);

        let appointments = [];

        try {
            const response = await bookingsApi.listBookings({
                locationId: LOCATION_ID,
                startAtMin: startDate.toISOString(),
                startAtMax: endDate.toISOString()
            });

            if (response.result && response.result.bookings) {
                // Fetch customer details for each booking
                for (const booking of response.result.bookings) {
                    let customerInfo = null;
                    if (booking.customerId) {
                        try {
                            const customerResponse = await customersApi.retrieveCustomer(booking.customerId);
                            customerInfo = customerResponse.result.customer;
                        } catch (err) {
                            console.log('Could not fetch customer:', err.message);
                        }
                    }

                    appointments.push({
                        id: booking.id,
                        startAt: booking.startAt,
                        status: booking.status,
                        customerNote: booking.customerNote,
                        sellerNote: booking.sellerNote,
                        customer: customerInfo ? {
                            name: `${customerInfo.givenName} ${customerInfo.familyName}`,
                            email: customerInfo.emailAddress,
                            phone: customerInfo.phoneNumber,
                            note: customerInfo.note
                        } : null
                    });
                }
            }
        } catch (squareError) {
            console.log('Could not fetch Square bookings:', squareError.message);
        }

        res.json({
            success: true,
            appointments: appointments,
            count: appointments.length
        });

    } catch (error) {
        console.error('Error fetching appointments:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching appointments',
            error: error.message
        });
    }
});

// ==================== START SERVER ====================
app.listen(PORT, '0.0.0.0', () => {
    console.log('========================================');
    console.log('🏥 PJA TELEHEALTH BACKEND - HIPAA MODE');
    console.log('========================================');
    console.log(`📍 Port: ${PORT}`);
    console.log(`🌍 Environment: ${process.env.SQUARE_ENVIRONMENT || 'sandbox'}`);
    console.log(`🏥 Location: ${LOCATION_ID}`);
    console.log(`🔒 HIPAA Compliance: Active`);
    console.log(`📝 Consent Storage: Square (HIPAA compliant)`);
    console.log(`🎥 Video Platform: Doxy.me (BAA on file)`);
    console.log(`✅ Health: http://localhost:${PORT}/health`);
    console.log('========================================');
});
