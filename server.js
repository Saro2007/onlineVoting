const express = require('express');
const http = require('http'); // [NEW] Required for Socket.io
const { Server } = require("socket.io"); // [NEW]
const bodyParser = require('body-parser');
const cors = require('cors');
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app); // [NEW] Wrap express
const io = new Server(server, {
    cors: {
        origin: "*", // Allow all origins for simplicity in this project
        methods: ["GET", "POST"]
    }
});

// Use process.env.PORT for deployment (Render/Railway/Heroku)
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json({ limit: '50mb' })); // High limit for Base64 photos
app.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'frontend')));

// Data Paths
const DATA_DIR = path.join(__dirname, 'data');
const FILES = {
    requests: path.join(DATA_DIR, 'requests.json'),
    voters: path.join(DATA_DIR, 'voters.json'),
    candidates: path.join(DATA_DIR, 'candidates.json'),
    config: path.join(DATA_DIR, 'config.json'),
    admins: path.join(DATA_DIR, 'admins.json'),
};

// Helper: Read Data
const readData = (file) => {
    if (!fs.existsSync(file)) return [];
    try {
        const data = fs.readFileSync(file, 'utf8');
        return JSON.parse(data);
    } catch (e) {
        console.error(`Error reading ${file}:`, e);
        return [];
    }
};

// Socket.io Connection Helper
io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);
    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
    });
});

// Helper: Write Data & Emit Update
const writeData = (file, data) => {
    try {
        fs.writeFileSync(file, JSON.stringify(data, null, 2));
        // [NEW] Emit event so frontend updates instantly
        io.emit('data_update', { file: path.basename(file), timestamp: Date.now() });
    } catch (e) {
        console.error(`Error writing ${file}:`, e);
    }
};

// Helper: Send Email (Real Implementation)
const sendEmail = async (to, subject, text) => {
    // SECURITY NOTE: In a real environment, use environment variables (process.env.EMAIL_USER)
    // For this specific setup, please manually enter your credentials below.
    const transporter = nodemailer.createTransport({
        service: 'gmail', // or 'outlook', 'yahoo', or use host/port for custom SMTP
        auth: {
            user: 'sarveshwara674@gmail.com', // <--- REPLACE THIS
            pass: 'hafs mopr pykw wqfv'     // <--- REPLACE THIS (Use App Password for Gmail)
        }
    });

    // Verify SMTP connection on startup (Debug)
    transporter.verify((error, success) => {
        if (error) {
            console.error('[EMAIL SETUP ERROR] Connection Failed:', error);
        } else {
            console.log('[EMAIL SETUP SUCCESS] SMTP Server Ready!');
        }
    });

    const mailOptions = {
        from: 'onlinevoting@demo.com',
        to: to,
        subject: subject,
        text: text
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log(`[EMAIL SENT] To: ${to}`);
        return true;
    } catch (error) {
        console.error('[EMAIL ERROR]', error);
        console.log(`[EMAIL FALLBACK - CONSOLE] To: ${to} | Body: ${text}`);
        return false;
    }
};

// --- ROUTES ---

// 1. Signup Request (Voter or Candidate)
app.post('/api/signup', (req, res) => {
    const { type, ...data } = req.body;
    // Basic validation could go here
    const requests = readData(FILES.requests);

    // Check for duplicates in requests, voters, candidates
    // Skipping complex dup checks for brevity, but ideally check Aadhaar/Mobile

    const newRequest = {
        id: Date.now().toString(),
        type, // 'voter' or 'candidate'
        status: 'pending',
        timestamp: new Date().toISOString(),
        ...data
    };

    requests.push(newRequest);
    writeData(FILES.requests, requests);
    res.json({ success: true, message: 'Signup request submitted successfully. Please wait for admin approval.' });
});

// 2. Login
app.post('/api/login', async (req, res) => {
    const { role, identifier, password, extra } = req.body; // extra could be Aadhaar for voter

    if (role === 'admin') {
        const admins = readData(FILES.admins);
        const admin = admins.find(a => a.id === identifier && a.password === password);
        if (admin) {
            res.json({ success: true, role: admin.role, token: 'admin-token-mock' }); // Simple mock token
        } else {
            res.json({ success: false, message: 'Invalid Admin Credentials' });
        }
    } else if (role === 'candidate') {
        const candidates = readData(FILES.candidates);
        const candidate = candidates.find(c => c.mobile === identifier && c.password === password);
        if (candidate) {
            res.json({ success: true, candidateId: candidate.id });
        } else {
            res.json({ success: false, message: 'Invalid Candidate Credentials' });
        }
    } else if (role === 'voter') {
        const voters = readData(FILES.voters);
        const voter = voters.find(v => v.aadhaar === identifier);

        if (voter) {
            if (voter.voted) {
                // Even if voted, they might want to see results? 
                // But typically voting login is to vote. 
                // Let's allow login but UI handles "Already Voted".
            }
            // Store OTP in global map
            global.otpMap = global.otpMap || {};
            global.otpMap[identifier] = otp;

            console.log(`[GENERATED OTP] User: ${voter.name} | OTP: ${otp}`);

            // Send Email (don't await indefinitely, or catch error to ensure response)
            try {
                await sendEmail(voter.email, 'Voting OTP', `Your OTP is ${otp}`);
            } catch (err) {
                console.error("Email send failed inside route:", err);
            }

            // Return OTP in response for debugging (since email might fail on free servers)
            res.json({ success: true, message: 'OTP sent to registered email', debug_otp: otp });
        } else {
            res.json({ success: false, message: 'Voter not found or not approved' });
        }
    } else {
        res.status(400).json({ success: false, message: 'Invalid Role' });
    }
});

// 3. Verify OTP
app.post('/api/verify-otp', (req, res) => {
    const { aadhaar, otp } = req.body;
    if (global.otpMap && global.otpMap[aadhaar] === otp) {
        delete global.otpMap[aadhaar];
        res.json({ success: true });
    } else {
        res.json({ success: false, message: 'Invalid OTP' });
    }
});

// 4. Get Candidates / Config
app.get('/api/candidates', (req, res) => {
    const candidates = readData(FILES.candidates);
    const config = readData(FILES.config);

    // If not published, maybe hide vote counts?
    // Requirement says: "Results table" in index.html.
    // So for public API, we might strip counts if !resultsPublished.

    const safeCandidates = candidates.map(c => {
        if (!config.resultsPublished) {
            const { voteCount, ...rest } = c;
            return rest;
        }
        return c;
    });

    res.json({ candidates: safeCandidates, config });
});

app.get('/api/config', (req, res) => {
    const config = readData(FILES.config);
    res.json(config);
});

// 5. Vote
app.post('/api/vote', (req, res) => {
    const { aadhaar, candidateId } = req.body;
    const voters = readData(FILES.voters);
    const candidates = readData(FILES.candidates);

    const voterIndex = voters.findIndex(v => v.aadhaar === aadhaar);
    if (voterIndex === -1) return res.json({ success: false, message: 'Voter not found' });
    if (voters[voterIndex].voted) return res.json({ success: false, message: 'Already voted' });

    const candidateIndex = candidates.findIndex(c => c.id === candidateId);
    if (candidateIndex === -1) return res.json({ success: false, message: 'Candidate not found' });

    // Update
    voters[voterIndex].voted = true;
    candidates[candidateIndex].voteCount = (candidates[candidateIndex].voteCount || 0) + 1;

    writeData(FILES.voters, voters);
    writeData(FILES.candidates, candidates);

    res.json({ success: true, message: 'Vote allocated successfully' });
});

// 6. Admin: Get Requests
app.get('/api/admin/requests', (req, res) => {
    const requests = readData(FILES.requests);
    res.json(requests);
});

// 7. Admin: Approve/Reject
app.post('/api/admin/decide', (req, res) => {
    const { requestId, action } = req.body; // action: 'approve' | 'reject'
    const requests = readData(FILES.requests);
    const reqIndex = requests.findIndex(r => r.id === requestId);

    if (reqIndex === -1) return res.json({ success: false, message: 'Request not found' });

    const request = requests[reqIndex];

    if (action === 'approve') {
        if (request.type === 'voter') {
            const voters = readData(FILES.voters);
            voters.push({
                aadhaar: request.aadhaar,
                email: request.email,
                name: request.name,
                dob: request.dob,
                photo: request.photo,
                voted: false
            });
            writeData(FILES.voters, voters);
        } else if (request.type === 'candidate') {
            const candidates = readData(FILES.candidates);
            candidates.push({
                id: Date.now().toString(), // Simple ID
                name: request.name,
                party: request.party,
                mobile: request.mobile,
                password: request.password,
                ideology: request.ideology || '',
                photo: request.photo,
                voteCount: 0
            });
            writeData(FILES.candidates, candidates);
        }
    }

    // Remove from requests
    requests.splice(reqIndex, 1);
    writeData(FILES.requests, requests);

    res.json({ success: true });
});

// 8. Admin: Publish Results
app.post('/api/admin/publish', (req, res) => {
    const { publish } = req.body; // true/false
    const config = readData(FILES.config);
    config.resultsPublished = publish;
    writeData(FILES.config, config);
    res.json({ success: true, newState: publish });
});

// 9. Candidate: Update Info
app.post('/api/candidate/update', (req, res) => {
    const { candidateId, ideology } = req.body;
    const candidates = readData(FILES.candidates);
    const index = candidates.findIndex(c => c.id === candidateId);
    if (index !== -1) {
        candidates[index].ideology = ideology;
        writeData(FILES.candidates, candidates);
        res.json({ success: true });
    } else {
        res.json({ success: false, message: 'Candidate not found' });
    }
});

// 10. Admin: Get Lists
app.get('/api/admin/voters', (req, res) => {
    const voters = readData(FILES.voters);
    res.json(voters);
});

app.get('/api/admin/candidates', (req, res) => {
    const candidates = readData(FILES.candidates);
    res.json(candidates);
});

app.get('/api/admin/subadmins', (req, res) => {
    const admins = readData(FILES.admins);
    res.json(admins);
});

// 11. Admin: Create Sub-Admin
app.post('/api/admin/create-subadmin', (req, res) => {
    const { adminId, password } = req.body;
    if (!adminId || !password) return res.json({ success: false, message: 'Invalid credentials' });

    const admins = readData(FILES.admins);
    if (admins.find(a => a.id === adminId)) { // Fixed check to match login logic
        return res.json({ success: false, message: 'Admin ID already exists' });
    }

    admins.push({
        id: adminId, // Using adminId as 'id' for login compatibility
        password,
        role: 'subadmin'
    });
    writeData(FILES.admins, admins);
    res.json({ success: true, message: 'Sub-Admin created' });
});

// 12. Admin: Delete Entity
app.post('/api/admin/delete', (req, res) => {
    const { type, id } = req.body;

    if (type === 'voter') {
        let voters = readData(FILES.voters);
        voters = voters.filter(v => v.aadhaar !== id);
        writeData(FILES.voters, voters);
    } else if (type === 'candidate') {
        let candidates = readData(FILES.candidates);
        candidates = candidates.filter(c => c.id !== id);
        writeData(FILES.candidates, candidates);
    } else if (type === 'admin') {
        let admins = readData(FILES.admins);
        admins = admins.filter(a => a.id !== id);
        writeData(FILES.admins, admins);
    } else {
        return res.json({ success: false, message: 'Invalid type' });
    }

    res.json({ success: true, message: 'Deleted successfully' });
});

// 13. Candidate: Update Profile
app.post('/api/candidate/update', (req, res) => {
    const { candidateId, ideology, photo, bio, manifesto, socials, education } = req.body;
    let candidates = readData(FILES.candidates);
    const index = candidates.findIndex(c => c.id === candidateId);

    if (index !== -1) {
        if (ideology !== undefined) candidates[index].ideology = ideology;
        if (photo !== undefined) candidates[index].photo = photo;
        if (bio !== undefined) candidates[index].bio = bio;
        if (manifesto !== undefined) candidates[index].manifesto = manifesto;
        if (socials !== undefined) candidates[index].socials = socials;
        if (education !== undefined) candidates[index].education = education;

        writeData(FILES.candidates, candidates);
        res.json({ success: true, message: 'Profile updated successfully' });
    } else {
        res.json({ success: false, message: 'Candidate not found' });
    }
});

// 14. Candidate: Get Details
app.get('/api/candidate/:id', (req, res) => {
    const candidates = readData(FILES.candidates);
    const candidate = candidates.find(c => c.id === req.params.id);
    if (candidate) {
        res.json({ success: true, candidate });
    } else {
        res.json({ success: false, message: 'Candidate not found' });
    }
});

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
