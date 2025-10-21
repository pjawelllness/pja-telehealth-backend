const express = require('express');
const cors = require('cors');
const path = require('path');
const { Client, Environment } = require('square');
const sgMail = require('@sendgrid/mail');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Square Client Setup
const squareClient = new Client({
    accessToken: process.env.SQUARE_ACCESS_TOKEN,
    environment: process.env.SQUARE_ENVIRONMENT === 'production' 
        ? Environment.Production 
        : Environment.Sandbox
});

// SendGrid Setup
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

// Configuration
const LOCATION_ID = 'LT1S9BE1EX0PW';
const TEAM_MEMBER_ID = 'TMpDyughFdZTf6ID'; // Patrick Smith
const PROVIDER_PASSWORD = process.env.PROVIDER_PASSWORD || 'JalenAnna2023!';
const PROVIDER_EMAIL = process.env.PROVIDER_EMAIL || 'pjawelllness@outlook.com';

// Helper function to handle BigInt serialization
function fixBigInt(obj) {
    return JSON.parse(JSON.stringify(obj, (key, value) =>
        typeof value === 'bigint' ? value.toString() : value
    ));
}

// Helper function to build comprehensive customer note
function buildCustomerNote(personal, health, consents) {
    return `
PATIENT INTAKE FORM
===================

PERSONAL INFORMATION:
- Name: ${personal.firstName} ${personal.lastName}
- Email: ${personal.email}
- Phone: ${personal.phone}
- Date of Birth: ${personal.dob}
- Emergency Contact: ${personal.emergencyName || 'Not provided'} (${personal.emergencyPhone || 'Not provided'})

CHIEF COMPLAINT:
${health.chiefComplaint}

SYMPTOM DURATION:
${health.symptomDuration}

CURRENT SYMPTOMS:
${health.symptoms.length > 0 ? health.symptoms.join(', ') : 'None reported'}

MEDICATIONS:
${health.medications || 'None reported'}

ALLERGIES:
${health.allergies || 'None reported'}

CONSENTS:
- HIPAA Privacy Notice: ${consents.hipaa ? 'Acknowledged' : 'Not acknowledged'}
- Telehealth Informed Consent: ${consents.telehealth ? 'Agreed' : 'Not agreed'}
- Session Recording: ${consents.recording ? 'Consented' : 'Declined'}

VIDEO CONSULTATION LINK:
https://doxy.me/PatrickPJAwellness

FORM COMPLETED: ${new Date().toISOString()}
`.trim();
}

// Helper function to build patient-facing note (for customer_note field)
function buildPatientNote(health) {
    return `Chief Complaint: ${health.chiefComplaint}

Duration: ${health.symptomDuration}
Symptoms: ${health.symptoms.length > 0 ? health.symptoms.join(', ') : 'None reported'}`;
}

// Helper function to build provider note (for seller_note field)
function buildProviderNote(personal, health, consents) {
    return `PATIENT: ${personal.firstName} ${personal.lastName}
DOB: ${personal.dob}
EMAIL: ${personal.email}
PHONE: ${personal.phone}

CHIEF COMPLAINT: ${health.chiefComplaint}
DURATION: ${health.symptomDuration}
SYMPTOMS: ${health.symptoms.join(', ')}

MEDICATIONS: ${health.medications || 'None'}
ALLERGIES: ${health.allergies || 'None'}

EMERGENCY CONTACT: ${personal.emergencyName || 'N/A'} (${personal.emergencyPhone || 'N/A'})

CONSENTS:
- HIPAA: ${consents.hipaa ? 'Yes' : 'No'}
- Telehealth: ${consents.telehealth ? 'Yes' : 'No'}
- Recording: ${consents.recording ? 'Yes' : 'No'}

PATIENT VIDEO LINK: https://doxy.me/PatrickPJAwellness
PROVIDER LINK: https://doxy.me/PatrickPJAwellness/provider`;
}

// UPDATED: Email sending functions using SendGrid Web API
async function sendPatientConfirmation(personal, service, selectedTime) {
    const appointmentDate = new Date(selectedTime.startAt);
    const formattedDate = appointmentDate.toLocaleDateString('en-US', { 
        weekday: 'long', 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric' 
    });
    
    const msg = {
        to: personal.email,
        from: {
            email: 'pjawelllness@outlook.com',
            name: 'PJA Wellness'
        },
        subject: `Appointment Confirmed - ${service.name}`,
        html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #2c5f2d;">Appointment Confirmed ✓</h2>
            
            <p>Dear ${personal.firstName} ${personal.lastName},</p>
            
            <p>Your telehealth appointment has been confirmed!</p>
            
            <div style="background-color: #f5f5f5; padding: 20px; margin: 20px 0; border-radius: 5px;">
                <h3 style="margin-top: 0;">Appointment Details:</h3>
                <p><strong>Service:</strong> ${service.name}</p>
                <p><strong>Date:</strong> ${formattedDate}</p>
                <p><strong>Time:</strong> ${selectedTime.time} EST</p>
                <p><strong>Duration:</strong> ${service.duration} minutes</p>
                <p><strong>Price:</strong> $${service.price}</p>
            </div>
            
            <div style="background-color: #e8f4e8; padding: 20px; margin: 20px 0; border-radius: 5px;">
                <h3 style="margin-top: 0;">📹 Join Your Video Consultation</h3>
                <p>At your appointment time, click this link to join:</p>
                <p style="text-align: center; margin: 20px 0;">
                    <a href="https://doxy.me/PatrickPJAwellness" 
                       style="background-color: #2c5f2d; color: white; padding: 12px 30px; 
                              text-decoration: none; border-radius: 5px; display: inline-block;">
                        Join Video Call
                    </a>
                </p>
                <p><strong>Video Link:</strong> https://doxy.me/PatrickPJAwellness</p>
            </div>
            
            <div style="margin: 20px 0;">
                <h3>Before Your Appointment:</h3>
                <ul>
                    <li>Test your camera and microphone</li>
                    <li>Find a quiet, private space</li>
                    <li>Have a list of current medications ready</li>
                    <li>Prepare any questions for Patrick Smith, your Board Certified Holistic Health Practitioner</li>
                </ul>
            </div>
            
            <div style="margin: 20px 0;">
                <h3>Need to Reschedule?</h3>
                <p>Please contact us at least 24 hours in advance:</p>
                <p>📧 Email: pjawelllness@outlook.com<br>
                   📞 Phone: (248) 794-7135</p>
            </div>
            
            <hr style="margin: 30px 0;">
            
            <p style="font-size: 12px; color: #666;">
                <strong>PJA Wellness - Telehealth Services</strong><br>
                Sterling Heights, Michigan<br>
                This is a HIPAA-compliant telehealth service.
            </p>
        </div>
        `
    };
    
    try {
        await sgMail.send(msg);
        console.log('✅ Patient confirmation email sent to:', personal.email);
    } catch (error) {
        console.error('❌ Failed to send patient email:', error);
        // Don't throw error - appointment is still created
    }
}

async function sendProviderNotification(personal, health, consents, service, selectedTime) {
    const appointmentDate = new Date(selectedTime.startAt);
    const formattedDate = appointmentDate.toLocaleDateString('en-US', { 
        weekday: 'long', 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric' 
    });
    
    const msg = {
        to: PROVIDER_EMAIL,
        from: {
            email: 'pjawelllness@outlook.com',
            name: 'PJA Wellness Booking System'
        },
        subject: `New Appointment: ${personal.firstName} ${personal.lastName} - ${selectedTime.time}`,
        html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #2c5f2d;">🆕 New Telehealth Appointment</h2>
            
            <div style="background-color: #f5f5f5; padding: 20px; margin: 20px 0; border-radius: 5px;">
                <h3 style="margin-top: 0;">Appointment Details:</h3>
                <p><strong>Service:</strong> ${service.name}</p>
                <p><strong>Date:</strong> ${formattedDate}</p>
                <p><strong>Time:</strong> ${selectedTime.time} EST</p>
                <p><strong>Duration:</strong> ${service.duration} minutes</p>
            </div>
            
            <div style="background-color: #fff3cd; padding: 20px; margin: 20px 0; border-radius: 5px;">
                <h3 style="margin-top: 0;">Patient Information:</h3>
                <p><strong>Name:</strong> ${personal.firstName} ${personal.lastName}</p>
                <p><strong>DOB:</strong> ${personal.dob}</p>
                <p><strong>Email:</strong> ${personal.email}</p>
                <p><strong>Phone:</strong> ${personal.phone}</p>
                <p><strong>Emergency Contact:</strong> ${personal.emergencyName || 'Not provided'} 
                   (${personal.emergencyPhone || 'Not provided'})</p>
            </div>
            
            <div style="background-color: #e8f4e8; padding: 20px; margin: 20px 0; border-radius: 5px;">
                <h3 style="margin-top: 0;">Chief Complaint:</h3>
                <p>${health.chiefComplaint}</p>
                <p><strong>Duration:</strong> ${health.symptomDuration}</p>
                <p><strong>Symptoms:</strong> ${health.symptoms.join(', ')}</p>
            </div>
            
            <div style="margin: 20px 0;">
                <h3>Medical History:</h3>
                <p><strong>Medications:</strong> ${health.medications || 'None reported'}</p>
                <p><strong>Allergies:</strong> ${health.allergies || 'None reported'}</p>
            </div>
            
            <div style="margin: 20px 0;">
                <h3>Consents:</h3>
                <p>✓ HIPAA Privacy Notice: ${consents.hipaa ? 'Acknowledged' : 'NOT acknowledged'}</p>
                <p>✓ Telehealth Consent: ${consents.telehealth ? 'Agreed' : 'NOT agreed'}</p>
                <p>✓ Session Recording: ${consents.recording ? 'Consented' : 'Declined'}</p>
            </div>
            
            <div style="background-color: #d1ecf1; padding: 20px; margin: 20px 0; border-radius: 5px;">
                <h3 style="margin-top: 0;">📹 Provider Portal:</h3>
                <p style="text-align: center; margin: 20px 0;">
                    <a href="https://doxy.me/PatrickPJAwellness/provider" 
                       style="background-color: #2c5f2d; color: white; padding: 12px 30px; 
                              text-decoration: none; border-radius: 5px; display: inline-block;">
                        Join Provider Room
                    </a>
                </p>
                <p><strong>Provider Link:</strong> https://doxy.me/PatrickPJAwellness/provider</p>
            </div>
            
            <hr style="margin: 30px 0;">
            
            <p style="font-size: 12px; color: #666;">
                This appointment was booked through the PJA Wellness Telehealth platform.
            </p>
        </div>
        `
    };
    
    try {
        await sgMail.send(msg);
        console.log('✅ Provider notification email sent to:', PROVIDER_EMAIL);
    } catch (error) {
        console.error('❌ Failed to send provider email:', error);
        // Don't throw error - appointment is still created
    }
}

// HEALTH CHECK ENDPOINT
app.get('/health', (req, res) => {
    res.json({ 
        status: 'healthy',
        service: 'pja-telehealth',
        timestamp: new Date().toISOString(),
        location: LOCATION_ID
    });
});

// SERVICES ENDPOINT - Get telehealth services
app.get('/api/services', async (req, res) => {
    try {
        console.log('📋 Searching for telehealth services...');
        
        // Use searchCatalogObjects with text_query for keyword search
        const result = await squareClient.catalogApi.searchCatalogObjects({
            objectTypes: ["ITEM"],
            query: {
                textQuery: {
                    keywords: ["telehealth"]
                }
            }
        });

        console.log(`✅ Found ${result.result.objects?.length || 0} objects from Square`);

        // Filter and map the services
        const services = (result.result.objects || [])
            .filter(obj => {
                // Only include APPOINTMENTS_SERVICE items with "telehealth" in the name
                const name = obj.itemData?.name || '';
                const productType = obj.itemData?.productType;
                return productType === 'APPOINTMENTS_SERVICE' && 
                       name.toLowerCase().includes('telehealth');
            })
            .map(obj => {
                const variation = obj.itemData?.variations?.[0];
                const priceAmount = variation?.itemVariationData?.priceMoney?.amount;
                const durationMs = variation?.itemVariationData?.serviceDuration;
                
                // Convert BigInt to Number BEFORE doing any math
                const priceInCents = typeof priceAmount === 'bigint' 
                    ? Number(priceAmount) 
                    : (priceAmount || 0);
                
                // Convert duration BigInt to Number BEFORE doing any math
                const durationInMs = typeof durationMs === 'bigint'
                    ? Number(durationMs)
                    : (durationMs || 3600000);

                return {
                    id: String(variation?.id || ''),
                    variationId: String(variation?.id || ''),
                    name: obj.itemData?.name || '',
                    description: obj.itemData?.description || '',
                    price: (priceInCents / 100).toFixed(2),
                    duration: durationInMs / 60000
                };
            });

        console.log(`✅ Returning ${services.length} telehealth services`);
        
        res.json({ services });
    } catch (error) {
        console.error('❌ Error fetching services:', error);
        res.status(500).json({ 
            error: 'Failed to fetch services',
            details: error.message 
        });
    }
});

// AVAILABILITY CHECK ENDPOINT
app.post('/api/availability', async (req, res) => {
    try {
        const { date, serviceId } = req.body;
        
        console.log(`🗓️ Checking availability for ${date}, service: ${serviceId}`);
        
        // Search for available appointment slots - Square handles all logic
        // This automatically excludes times when Patrick has existing bookings
        const searchBody = {
            query: {
                filter: {
                    locationId: LOCATION_ID,
                    startAtRange: {
                        startAt: `${date}T00:00:00Z`,
                        endAt: `${date}T23:59:59Z`
                    },
                    segmentFilters: [{
                        serviceVariationId: serviceId,
                        teamMemberIdFilter: {
                            any: ['TMpDyughFdZTf6ID']  // Patrick Smith only
                        }
                    }]
                }
            }
        };
        
        const response = await squareClient.bookingsApi.searchAvailability(searchBody);
        
        console.log(`✅ Square returned ${response.result.availabilities?.length || 0} available slots`);
        
        // Just format what Square tells us is available
        // Square already factors in:
        // - Patrick's working hours set in Square dashboard
        // - Existing bookings
        // - Service duration
        // - Time blocks
        const availabilities = (response.result.availabilities || []).map(slot => {
            // Convert to plain string values to avoid BigInt serialization issues
            const startAtString = String(slot.startAt);
            return {
                startAt: startAtString,
                time: new Date(startAtString).toLocaleTimeString('en-US', {
                    hour: 'numeric',
                    minute: '2-digit',
                    hour12: true,
                    timeZone: 'America/New_York'
                })
            };
        });
        
        console.log(`✅ Returning ${availabilities.length} slots to frontend`);
        
        res.json({ availabilities });
    } catch (error) {
        console.error('❌ Availability check error:', error);
        res.status(500).json({ 
            error: 'Failed to check availability',
            details: error.message 
        });
    }
});

// BOOKING CREATION ENDPOINT
app.post('/api/booking', async (req, res) => {
    try {
        const { personal, health, consents, service, selectedTime } = req.body;
        
        console.log('📝 Creating booking for:', personal.email);
        
        // Search for existing customer
        let customerId = null;
        try {
            const searchResult = await squareClient.customersApi.searchCustomers({
                query: {
                    filter: {
                        emailAddress: {
                            exact: personal.email
                        }
                    }
                }
            });
            
            if (searchResult.result.customers && searchResult.result.customers.length > 0) {
                customerId = searchResult.result.customers[0].id;
                console.log('✅ Found existing customer:', customerId);
                
                // Update customer with latest information
                await squareClient.customersApi.updateCustomer(customerId, {
                    givenName: personal.firstName,
                    familyName: personal.lastName,
                    emailAddress: personal.email,
                    phoneNumber: personal.phone,
                    note: buildCustomerNote(personal, health, consents)
                });
                console.log('✅ Updated customer information');
            }
        } catch (searchError) {
            console.log('ℹ️ No existing customer found, will create new');
        }
        
        // Create new customer if not found
        if (!customerId) {
            const customerResult = await squareClient.customersApi.createCustomer({
                givenName: personal.firstName,
                familyName: personal.lastName,
                emailAddress: personal.email,
                phoneNumber: personal.phone,
                note: buildCustomerNote(personal, health, consents)
            });
            customerId = customerResult.result.customer.id;
            console.log('✅ Created new customer:', customerId);
        }
        
        // UPDATED: Create booking in Square
        const bookingResult = await squareClient.bookingsApi.createBooking({
            booking: {
                locationId: LOCATION_ID,
                customerId: customerId,
                startAt: selectedTime.startAt,
                appointmentSegments: [{
                    durationMinutes: service.duration,
                    serviceVariationId: service.variationId,
                    teamMemberId: TEAM_MEMBER_ID,
                    serviceVariationVersion: BigInt(Date.now())
                }],
                customerNote: buildPatientNote(health),
                sellerNote: buildProviderNote(personal, health, consents)
            }
        });
        
        console.log('✅ Booking created:', bookingResult.result.booking.id);
        
        // Send emails after successful booking
        await Promise.all([
            sendPatientConfirmation(personal, service, selectedTime),
            sendProviderNotification(personal, health, consents, service, selectedTime)
        ]);
        
        res.json({
            success: true,
            bookingId: bookingResult.result.booking.id,
            confirmation: {
                service: service.name,
                date: new Date(selectedTime.startAt).toLocaleDateString(),
                time: selectedTime.time,
                duration: `${service.duration} minutes`,
                price: `$${service.price}`,
                videoLink: 'https://doxy.me/PatrickPJAwellness'
            }
        });
        
    } catch (error) {
        console.error('❌ Booking error:', error);
        res.status(500).json({ 
            error: 'Failed to create booking',
            details: error.message 
        });
    }
});

// PROVIDER LOGIN ENDPOINT
app.post('/api/provider-login', (req, res) => {
    const { password } = req.body;
    
    if (password === PROVIDER_PASSWORD) {
        res.json({ success: true });
    } else {
        res.status(401).json({ 
            success: false, 
            error: 'Invalid password' 
        });
    }
});

// PROVIDER BOOKINGS ENDPOINT
app.get('/api/provider/bookings', async (req, res) => {
    try {
        console.log('📋 Fetching provider bookings...');
        
        const now = new Date();
        const endDate = new Date();
        endDate.setDate(endDate.getDate() + 30);
        
        const response = await squareClient.bookingsApi.listBookings(
            undefined,              // limit
            undefined,              // cursor
            undefined,              // customerId (not filtering by customer)
            TEAM_MEMBER_ID,         // teamMemberId (TMpDyughFdZTf6ID)
            LOCATION_ID,            // locationId (LT1S9BE1EX0PW)
            now.toISOString(),      // startAtMin
            endDate.toISOString()   // startAtMax
        );
        
        const bookings = (response.result.bookings || [])
            .map(booking => ({
                id: booking.id,
                startAt: booking.startAt,
                customer: {
                    name: `${booking.customerNote?.split('\n')[0]?.replace('Chief Complaint: ', '') || 'Unknown'}`,
                    email: booking.sellerNote?.match(/EMAIL: (.+)/)?.[1] || '',
                    phone: booking.sellerNote?.match(/PHONE: (.+)/)?.[1] || ''
                },
                customerNote: booking.customerNote,
                sellerNote: booking.sellerNote
            }))
            .sort((a, b) => new Date(a.startAt) - new Date(b.startAt));
        
        console.log(`✅ Found ${bookings.length} bookings`);
        
        res.json({ bookings });
    } catch (error) {
        console.error('❌ Error fetching bookings:', error);
        res.status(500).json({ 
            error: 'Failed to fetch bookings',
            details: error.message 
        });
    }
});

// Serve index.html for root route
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Catch-all route to serve frontend
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`
🚀 PJA Wellness Telehealth Backend Running!
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📍 Port: ${PORT}
🏥 Location: ${LOCATION_ID}
👨‍⚕️ Provider: Patrick Smith (${TEAM_MEMBER_ID})
🔒 Environment: ${process.env.SQUARE_ENVIRONMENT || 'production'}
🎥 Patient Video Link: https://doxy.me/PatrickPJAwellness
👨‍⚕️ Provider Portal: https://doxy.me/PatrickPJAwellness/provider
📧 Email Notifications: ${process.env.SENDGRID_API_KEY ? 'ENABLED' : 'DISABLED'}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    `);
});
