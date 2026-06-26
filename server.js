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
                    status: 'idle', 
                    timeRemaining: 0, 
                    pendingPayment: null,
                    session: { minutes: 0, amount: 0 }
                };
                broadcastToAll({ 
                    type: 'pc_status', 
                    pcId, 
                    status: 'idle', 
                    timeRemaining: 0,
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
                }
            }

            // 🔥 PAYMENT REQUEST - shows "Confirm Payment" button
            if (data.type === 'payment_request') {
                if (pcs[data.pcId]) {
                    const pc = pcs[data.pcId];
                    pc.pendingPayment = { 
                        minutes: data.minutes, 
                        amount: data.amount 
                    };
                    pc.status = 'pending';
                    console.log(`💰 Payment request from ${data.pcId}: ₱${data.amount} (${data.minutes}min)`);
                    
                    // ONLY send payment_request to staff (this shows the buttons)
                    broadcastToStaffAndMonitors({
                        type: 'payment_request',
                        pcId: data.pcId,
                        minutes: data.minutes,
                        amount: data.amount
                    });
                } else {
                    console.log(`❌ PC ${data.pcId} not found`);
                }
            }

            // 🔥 CONFIRM PAYMENT - starts the timer
            if (data.type === 'confirm_payment' && isStaff) {
                console.log(`🔑 Staff confirming payment for ${data.pcId}`);
                if (pcs[data.pcId]) {
                    const pc = pcs[data.pcId];
                    pc.pendingPayment = null;
                    pc.status = 'running';
                    pc.session = { minutes: data.minutes, amount: data.amount };
                    pc.timeRemaining = data.minutes * 60;
                    
                    // Send start_session to client
                    if (pc.ws && pc.ws.readyState === WebSocket.OPEN) {
                        pc.ws.send(JSON.stringify({
                            type: 'start_session',
                            pcId: data.pcId,
                            minutes: data.minutes,
                            amount: data.amount
                        }));
                        console.log(`📤 Sent start_session to ${data.pcId}`);
                    }
                    
                    // Send unlock to client
                    if (pc.ws && pc.ws.readyState === WebSocket.OPEN) {
                        pc.ws.send(JSON.stringify({
                            type: 'unlock',
                            pcId: data.pcId
                        }));
                    }
                    
                    // Update status for everyone
                    broadcastToAll({
                        type: 'pc_status',
                        pcId: data.pcId,
                        status: 'running',
                        timeRemaining: data.minutes * 60,
                        pendingPayment: null,
                        session: { minutes: data.minutes, amount: data.amount }
                    });
                    
                    broadcastToAll({
                        type: 'log',
                        pcId: data.pcId,
                        action: '✅ Payment Confirmed - Session Started',
                        amount: `₱${data.amount} (${data.minutes}min)`
                    });
                }
            }

            // Decline payment
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
                    
                    broadcastToAll({
                        type: 'pc_status',
                        pcId: data.pcId,
                        status: 'idle',
                        timeRemaining: 0,
                        pendingPayment: null,
                        session: { minutes: 0, amount: 0 }
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
                    
                    broadcastToAll({
                        type: 'pc_status',
                        pcId: data.pcId,
                        status: 'idle',
                        timeRemaining: 0,
                        pendingPayment: null,
                        session: { minutes: 0, amount: 0 }
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
                    broadcastToAll({
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
                    
                    broadcastToAll({
                        type: 'pc_status',
                        pcId: data.pcId,
                        status: 'idle',
                        timeRemaining: 0,
                        pendingPayment: null,
                        session: { minutes: 0, amount: 0 }
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
                    
                    broadcastToAll({
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

            if (data.type === 'pong') {
                // Connection is alive
            }

        } catch(e) {
            console.error('❌ Error processing message:', e);
        }
    });

    ws.on('close', () => {
        clearInterval(pingInterval);
        if (pcId && pcs[pcId]) {
            delete pcs[pcId];
            broadcastToAll({ type: 'pc_offline', pcId });
            console.log(`📡 PC ${pcId} disconnected`);
        }
        const staffIndex = staff.indexOf(ws);
        if (staffIndex > -1) staff.splice(staffIndex, 1);
        const monitorIndex = monitors.indexOf(ws);
        if (monitorIndex > -1) monitors.splice(monitorIndex, 1);
    });
});

function broadcastToAll(data) {
    const allClients = [...staff, ...monitors];
    allClients.forEach(s => {
        if (s && s.readyState === WebSocket.OPEN) {
            try {
                s.send(JSON.stringify(data));
            } catch(e) {}
        }
    });
}

function broadcastToStaffAndMonitors(data) {
    // Only send to staff and monitors (not clients)
    const allClients = [...staff, ...monitors];
    allClients.forEach(s => {
        if (s && s.readyState === WebSocket.OPEN) {
            try {
                s.send(JSON.stringify(data));
            } catch(e) {}
        }
    });
}

console.log('🚀 Server running on port', process.env.PORT || 3000);