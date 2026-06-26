// 🔥 CONFIRM PAYMENT - Fixed order
if (data.type === 'confirm_payment' && isStaff) {
    console.log(`🔑 Staff confirming payment for ${data.pcId}`);
    if (pcs[data.pcId]) {
        const pc = pcs[data.pcId];
        pc.pendingPayment = null;
        pc.status = 'running';
        pc.session = { minutes: data.minutes, amount: data.amount };
        pc.timeRemaining = data.minutes * 60;
        
        console.log(`✅ Starting session on ${data.pcId}: ${data.minutes}min · ₱${data.amount}`);
        
        // 🔥 FIRST: Broadcast status to staff and monitors
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
        
        // 🔥 SECOND: Send unlock to client
        if (pc.ws && pc.ws.readyState === WebSocket.OPEN) {
            const unlockMsg = {
                type: 'unlock',
                pcId: data.pcId
            };
            pc.ws.send(JSON.stringify(unlockMsg));
            console.log(`📤 Sent unlock to ${data.pcId}`);
        }
        
        // 🔥 THIRD: Send start_session to client (with a small delay)
        if (pc.ws && pc.ws.readyState === WebSocket.OPEN) {
            // Use setTimeout to ensure unlock is processed first
            setTimeout(() => {
                const startMsg = {
                    type: 'start_session',
                    pcId: data.pcId,
                    minutes: data.minutes,
                    amount: data.amount
                };
                pc.ws.send(JSON.stringify(startMsg));
                console.log(`📤 Sent start_session to ${data.pcId}:`, startMsg);
            }, 500);
        } else {
            console.log(`❌ Client ${data.pcId} websocket is not open`);
        }
    } else {
        console.log(`❌ PC ${data.pcId} not found for confirmation`);
    }
}