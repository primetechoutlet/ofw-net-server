const WebSocket = require('ws');
const server = new WebSocket.Server({ port: process.env.PORT || 3000 });

const pcs = {};
const staff = [];
const monitors = [];

console.log('🚀 OFW-NET Server starting...');

server.on('connection', (ws) => {
    let pcId = null;
    let isStaff = false;
    let isMonitor = false;

    // Keep connection alive
    const pingInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'ping' }));
        }
    }, 15000);

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            console.log('📩 Received:', data.type, data.pcId || '');

            // Register PC
            if (data.type === 'register') {
                pcId = data.pcId;
                pcs[pcId] = { 
                    ws, 
                    pcId, 
                    status: data.status, 
                    timeRemaining: data.timeRemaining || 0, 
                    pendingPayment: null,
                    session: { minutes: 0, amount: 0 }
                };
                broadcastToStaffAndMonitors({ 
                    type: 'pc_status', 
                    pcId, 
                    status: data.status, 
                    timeRemaining: data.timeRemaining || 0,
                    pendingPayment: null,
                    session: { minutes: 0, amount: 0 }
                });
                console.log(`✅ PC ${pcId} registered`);
            }

            // Staff login
            if (data.type === 'staff_login') {
                if (data.password === 'ofw123') {
                    isStaff = true;
                    staff.push(ws);
                    console.log('✅ Staff logged in');
                    // Send all existing PC statuses
                    Object.keys(pcs).forEach(id => {
                        const pc = pcs[id];
                        ws.send(JSON.stringify({
                            type: 'pc_status',
                            pcId: id,
                            status: pc.status || 'idle',
                            timeRemaining: pc.timeRemaining || 0,
                            pendingPayment: pc.pendingPayment || null,
                            session: pc.session || { minutes: 0, amount: 0 }
                        }));
                    });
                } else {
                    ws.send(JSON.stringify({ type: 'error', message: 'Invalid staff password' }));
                }
            }

            // Monitor login
            if (data.type === 'monitor_login') {
                if (data.password === 'ofw123') {
                    isMonitor = true;
                    monitors.push(ws);
                    console.log('✅ Monitor logged in');
                    Object.keys(pcs).forEach(id => {
                        const pc = pcs[id];
                        ws.send(JSON.stringify({
                            type: 'pc_status',
                            pcId: id,
                            status: pc.status || 'idle',
                            timeRemaining: pc.timeRemaining || 0,
                            pendingPayment: pc.pendingPayment || null,
                            session: pc.session || { minutes: 0, amount: 0 }
                        }));
                    });
                } else {
                    ws.send(JSON.stringify({ type: 'error', message: 'Invalid monitor password' }));
                }
            }

            // Payment request from client
            if (data.type === 'payment_request') {
                if (pcs[data.pcId]) {
                    const pc = pcs[data.pcId];
                    pc.pendingPayment = { 
                        minutes: data.minutes, 
                        amount: data.amount 
                    };
                    pc.status = 'pending';
                    console.log(`💰 Payment request from ${data.pcId}: ₱${data.amount} (${data.minutes}min)`);
                    
                    broadcastToStaffAndMonitors({
                        type: 'payment_request',
                        pcId: data.pcId,
                        minutes: data.minutes,
                        amount: data.amount
                    });
                } else {
                    console.log(`❌ PC ${data.pcId} not found for payment request`);
                }
            }

            // 🔥 CONFIRM PAYMENT - FIXED to send both unlock AND start_session
            if (data.type === 'confirm_payment' && isStaff) {
                console.log(`🔑 Staff confirming payment for ${data.pcId}`);
                if (pcs[data.pcId]) {
                    const pc = pcs[data.pcId];
                    pc.pendingPayment = null;
                    pc.status = 'running';
                    pc.session = { minutes: data.minutes, amount: data.amount };
                    pc.timeRemaining = data.minutes * 60;
                    
                    console.log(`✅ Starting session on ${data.pcId}: ${data.minutes}min · ₱${data.amount}`);
                    
                    // 🔥 FIRST: Send start_session to client
                    if (pc.ws && pc.ws.readyState === WebSocket.OPEN) {
                        const startMsg = {
                            type: 'start_session',
                            pcId: data.pcId,
                            minutes: data.minutes,
                            amount: data.amount
                        };
                        pc.ws.send(JSON.stringify(startMsg));
                        console.log(`📤 Sent start_session to ${data.pcId}:`, startMsg);
                    } else {
                        console.log(`❌ Client ${data.pcId} websocket is not open`);
                    }
                    
                    // 🔥 SECOND: Send unlock to client
                    if (pc.ws && pc.ws.readyState === WebSocket.OPEN) {
                        const unlockMsg = {
                            type: 'unlock',
                            pcId: data.pcId
                        };
                        pc.ws.send(JSON.stringify(unlockMsg));
                        console.log(`📤 Sent unlock to ${data.pcId}`);
                    }
                    
                    // Broadcast to staff and monitors
                    broadcastToStaffAndMonitors({
                        type: 'pc_status',
                        pcId: data.pcId,
                        status: 'running',
                        timeRemaining: data.minutes * 60,
                        pendingPayment: null,
                        session: { minutes: data.minutes, amount: data.amount }
                    });
                    
                    broadcastToStaffAndMonitors({
                        type: 'log',
                        pcId: data.pcId,
                        action: '✅ Payment Confirmed - Session Started',
                        amount: `₱${data.amount} (${data.minutes}min)`
                    });
                } else {
                    console.log(`❌ PC ${data.pcId} not found for confirmation`);
                }
            }

            // Decline payment (staff)
            if (data.type === 'decline_payment' && isStaff) {
                if (pcs[data.pcId]) {
                    const pc = pcs[data.pcId];
                    pc.pendingPayment = null;
                    pc.status = 'idle';
                    
                    if (pc.ws && pc.ws.readyState === WebSocket.OPEN) {
                        pc.ws.send(JSON.stringify({
                            type: 'payment_declined',
                            pcId: data.pcId
                        }));
                    }
                    
                    broadcastToStaffAndMonitors({
                        type: 'pc_status',
                        pcId: data.pcId,
                        status: 'idle',
                        timeRemaining: 0,
                        pendingPayment: null,
                        session: { minutes: 0, amount: 0 }
                    });
                    
                    broadcastToStaffAndMonitors({
                        type: 'log',
                        pcId: data.pcId,
                        action: '❌ Payment Declined',
                        amount: '-'
                    });
                    console.log(`❌ Payment declined for ${data.pcId}`);
                }
            }

            // Unlock PC (staff)
            if (data.type === 'unlock' && isStaff) {
                if (pcs[data.pcId]) {
                    const pc = pcs[data.pcId];
                    pc.status = 'idle';
                    pc.pendingPayment = null;
                    
                    if (pc.ws && pc.ws.readyState === WebSocket.OPEN) {
                        pc.ws.send(JSON.stringify({
                            type: 'unlock',
                            pcId: data.pcId
                        }));
                    }
                    
                    broadcastToStaffAndMonitors({
                        type: 'pc_status',
                        pcId: data.pcId,
                        status: 'idle',
                        timeRemaining: 0,
                        pendingPayment: null,
                        session: { minutes: 0, amount: 0 }
                    });
                    
                    broadcastToStaffAndMonitors({
                        type: 'log',
                        pcId: data.pcId,
                        action: '🔓 Unlocked',
                        amount: '-'
                    });
                    console.log(`🔓 Unlocked ${data.pcId}`);
                }
            }

            // Status update from client
            if (data.type === 'status') {
                if (pcs[data.pcId]) {
                    const pc = pcs[data.pcId];
                    pc.status = data.status || pc.status;
                    pc.timeRemaining = data.timeRemaining || 0;
                    if (data.session) {
                        pc.session = data.session;
                    }
                    console.log(`📊 Status update from ${data.pcId}: ${pc.status}, ${pc.timeRemaining}s`);
                    
                    broadcastToStaffAndMonitors({
                        type: 'pc_status',
                        pcId: data.pcId,
                        status: pc.status,
                        timeRemaining: pc.timeRemaining,
                        pendingPayment: pc.pendingPayment || null,
                        session: pc.session || { minutes: 0, amount: 0 }
                    });
                }
            }

            // Stop session (staff)
            if (data.type === 'stop_session' && isStaff) {
                if (pcs[data.pcId]) {
                    const pc = pcs[data.pcId];
                    pc.status = 'idle';
                    pc.timeRemaining = 0;
                    pc.session = { minutes: 0, amount: 0 };
                    
                    if (pc.ws && pc.ws.readyState === WebSocket.OPEN) {
                        pc.ws.send(JSON.stringify({
                            type: 'stop_session',
                            pcId: data.pcId
                        }));
                    }
                    
                    broadcastToStaffAndMonitors({
                        type: 'pc_status',
                        pcId: data.pcId,
                        status: 'idle',
                        timeRemaining: 0,
                        pendingPayment: null,
                        session: { minutes: 0, amount: 0 }
                    });
                    
                    broadcastToStaffAndMonitors({
                        type: 'log',
                        pcId: data.pcId,
                        action: '⏹️ Session Stopped',
                        amount: '-'
                    });
                    console.log(`⏹️ Stopped session on ${data.pcId}`);
                }
            }

            // Lock PC (staff)
            if (data.type === 'lock' && isStaff) {
                if (pcs[data.pcId]) {
                    const pc = pcs[data.pcId];
                    pc.status = 'locked';
                    pc.timeRemaining = 0;
                    
                    if (pc.ws && pc.ws.readyState === WebSocket.OPEN) {
                        pc.ws.send(JSON.stringify({
                            type: 'lock',
                            pcId: data.pcId
                        }));
                    }
                    
                    broadcastToStaffAndMonitors({
                        type: 'pc_status',
                        pcId: data.pcId,
                        status: 'locked',
                        timeRemaining: 0,
                        pendingPayment: null,
                        session: { minutes: 0, amount: 0 }
                    });
                    console.log(`🔒 Locked ${data.pcId}`);
                }
            }

            // Pong response (keep alive)
            if (data.type === 'pong') {
                // Connection is alive
            }

        } catch(e) {
            console.error('❌ Error processing message:', e);
            console.error('Message was:', message);
        }
    });

    ws.on('close', () => {
        clearInterval(pingInterval);
        console.log(`📡 Connection closed for ${pcId || 'unknown'}`);
        if (pcId && pcs[pcId]) {
            delete pcs[pcId];
            broadcastToStaffAndMonitors({ 
                type: 'pc_offline', 
                pcId,
                status: 'offline'
            });
            console.log(`📡 PC ${pcId} disconnected`);
        }
        // Remove from staff/monitor arrays
        const staffIndex = staff.indexOf(ws);
        if (staffIndex > -1) staff.splice(staffIndex, 1);
        const monitorIndex = monitors.indexOf(ws);
        if (monitorIndex > -1) monitors.splice(monitorIndex, 1);
    });

    ws.on('error', (error) => {
        console.error('❌ WebSocket error:', error);
    });
});

function broadcastToStaffAndMonitors(data) {
    const allClients = [...staff, ...monitors];
    let sentCount = 0;
    allClients.forEach(s => {
        if (s && s.readyState === WebSocket.OPEN) {
            try {
                s.send(JSON.stringify(data));
                sentCount++;
            } catch(e) {
                console.error('❌ Error broadcasting:', e);
            }
        }
    });
    if (sentCount > 0) {
        console.log(`📤 Broadcasted ${data.type} to ${sentCount} clients`);
    }
}

console.log('🚀 Server running on port', process.env.PORT || 3000);