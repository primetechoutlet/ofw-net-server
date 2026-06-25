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

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);

            // Register PC
            if (data.type === 'register') {
                pcId = data.pcId;
                pcs[pcId] = { ws, pcId, status: data.status, timeRemaining: data.timeRemaining || 0, pendingPayment: null };
                broadcastToAll({ type: 'pc_status', pcId, status: data.status, timeRemaining: data.timeRemaining || 0 });
                console.log(`✅ PC ${pcId} registered`);
            }

            // Staff login
            if (data.type === 'staff_login') {
                if (data.password === 'ofw123') {
                    isStaff = true;
                    staff.push(ws);
                    Object.keys(pcs).forEach(id => {
                        ws.send(JSON.stringify({
                            type: 'pc_status',
                            pcId: id,
                            status: pcs[id].status,
                            timeRemaining: pcs[id].timeRemaining || 0,
                            pendingPayment: pcs[id].pendingPayment
                        }));
                    });
                    console.log('✅ Staff logged in');
                }
            }

            // Monitor login
            if (data.type === 'monitor_login') {
                if (data.password === 'ofw123') {
                    isMonitor = true;
                    monitors.push(ws);
                    Object.keys(pcs).forEach(id => {
                        ws.send(JSON.stringify({
                            type: 'pc_status',
                            pcId: id,
                            status: pcs[id].status,
                            timeRemaining: pcs[id].timeRemaining || 0,
                            pendingPayment: pcs[id].pendingPayment
                        }));
                    });
                    console.log('✅ Monitor logged in');
                }
            }

            // Payment request
            if (data.type === 'payment_request') {
                if (pcs[data.pcId]) {
                    pcs[data.pcId].pendingPayment = { minutes: data.minutes, amount: data.amount };
                    pcs[data.pcId].status = 'pending';
                    broadcastToAll({
                        type: 'payment_request',
                        pcId: data.pcId,
                        minutes: data.minutes,
                        amount: data.amount
                    });
                    console.log(`💰 Payment request from ${data.pcId}: ₱${data.amount} (${data.minutes}min)`);
                }
            }

            // Confirm payment
            if (data.type === 'confirm_payment' && isStaff) {
                if (pcs[data.pcId]) {
                    pcs[data.pcId].pendingPayment = null;
                    pcs[data.pcId].status = 'idle';
                    pcs[data.pcId].ws.send(JSON.stringify({
                        type: 'payment_confirmed',
                        pcId: data.pcId,
                        minutes: data.minutes,
                        amount: data.amount
                    }));
                    broadcastToAll({
                        type: 'log',
                        pcId: data.pcId,
                        action: '✅ Payment Confirmed',
                        amount: `₱${data.amount}`
                    });
                    console.log(`✅ Payment confirmed for ${data.pcId}`);
                }
            }

            // Decline payment
            if (data.type === 'decline_payment' && isStaff) {
                if (pcs[data.pcId]) {
                    pcs[data.pcId].pendingPayment = null;
                    pcs[data.pcId].status = 'idle';
                    pcs[data.pcId].ws.send(JSON.stringify({
                        type: 'payment_declined',
                        pcId: data.pcId
                    }));
                    broadcastToAll({
                        type: 'log',
                        pcId: data.pcId,
                        action: '❌ Payment Declined',
                        amount: '-'
                    });
                    console.log(`❌ Payment declined for ${data.pcId}`);
                }
            }

            // Unlock PC
            if (data.type === 'unlock' && isStaff) {
                if (pcs[data.pcId]) {
                    pcs[data.pcId].status = 'idle';
                    pcs[data.pcId].ws.send(JSON.stringify({
                        type: 'unlock',
                        pcId: data.pcId
                    }));
                    broadcastToAll({
                        type: 'unlock_success',
                        pcId: data.pcId
                    });
                    console.log(`🔓 Unlocked ${data.pcId}`);
                }
            }

            // Status update
            if (data.type === 'status') {
                if (pcs[data.pcId]) {
                    pcs[data.pcId].status = data.status;
                    pcs[data.pcId].timeRemaining = data.timeRemaining || 0;
                    pcs[data.pcId].session = data.session || { minutes: 0, amount: 0 };
                    broadcastToAll({
                        type: 'pc_status',
                        pcId: data.pcId,
                        status: data.status,
                        timeRemaining: data.timeRemaining || 0,
                        session: data.session || { minutes: 0, amount: 0 },
                        pendingPayment: pcs[data.pcId].pendingPayment
                    });
                }
            }

            // Stop session
            if (data.type === 'stop_session' && isStaff) {
                if (pcs[data.pcId]) {
                    pcs[data.pcId].ws.send(JSON.stringify({
                        type: 'stop_session',
                        pcId: data.pcId
                    }));
                    broadcastToAll({
                        type: 'log',
                        pcId: data.pcId,
                        action: '⏹️ Session Stopped',
                        amount: '-'
                    });
                    console.log(`⏹️ Stopped session on ${data.pcId}`);
                }
            }

            // Lock PC
            if (data.type === 'lock' && isStaff) {
                if (pcs[data.pcId]) {
                    pcs[data.pcId].status = 'locked';
                    pcs[data.pcId].ws.send(JSON.stringify({
                        type: 'lock',
                        pcId: data.pcId
                    }));
                    broadcastToAll({
                        type: 'pc_status',
                        pcId: data.pcId,
                        status: 'locked',
                        timeRemaining: 0
                    });
                    console.log(`🔒 Locked ${data.pcId}`);
                }
            }

        } catch(e) {
            console.error('Error:', e);
        }
    });

    ws.on('close', () => {
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
        if (s.readyState === WebSocket.OPEN) {
            s.send(JSON.stringify(data));
        }
    });
}

console.log('🚀 Server running on port', process.env.PORT || 3000);