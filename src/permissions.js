import { query, queryOne } from './database.js';
import { config } from './config.js';

/**
 * Check if group is authorized (hardcoded group ID)
 */
export function isGroupAuthorized(groupId) {
    return groupId === config.allowedGroupId;
}

/**
 * Check if user is authorized
 */
export async function isUserAuthorized(userId) {
    try {
        const row = await queryOne(
            "SELECT id FROM authorized_users WHERE user_id = $1 AND status = 'active'",
            [userId]
        );
        return !!row;
    } catch (error) {
        console.error('Error checking user authorization:', error);
        return false;
    }
}

/**
 * Request user access - create pending request
 */
export async function requestUserAccess(userId, username, chatId) {
    try {
        const existing = await queryOne(
            "SELECT id FROM pending_user_requests WHERE user_id = $1 AND status = 'pending' LIMIT 1",
            [userId]
        );
        if (existing) {
            return { success: false, message: 'Request already pending' };
        }

        if (await isUserAuthorized(userId)) {
            return { success: false, message: 'User already authorized' };
        }

        const row = await queryOne(
            `INSERT INTO pending_user_requests (user_id, username, chat_id, status)
             VALUES ($1, $2, $3, 'pending')
             RETURNING id`,
            [userId, username || null, chatId]
        );

        return { success: true, requestId: row.id };
    } catch (error) {
        console.error('Error creating pending request:', error);
        return { success: false, message: 'Failed to create request' };
    }
}

/**
 * Directly authorize a user without a pending request (used for the owner and
 * for manual re-provisioning). Idempotent.
 */
export async function ensureAuthorized(userId, username, chatId, authorizedBy) {
    try {
        const row = await queryOne(
            `INSERT INTO authorized_users (user_id, username, chat_id, authorized_by, status)
             VALUES ($1, $2, $3, $4, 'active')
             ON CONFLICT (user_id) DO UPDATE SET
                username = COALESCE(EXCLUDED.username, authorized_users.username),
                chat_id = EXCLUDED.chat_id,
                status = 'active',
                authorized_at = now()
             RETURNING *`,
            [userId, username || null, chatId, authorizedBy]
        );
        return { success: true, chatId: row.chat_id, username: row.username };
    } catch (error) {
        console.error('Error ensuring user authorization:', error);
        return { success: false, message: 'Failed to authorize user' };
    }
}

/**
 * Approve user access
 */
export async function approveUser(userId, approvedBy) {
    try {
        const request = await queryOne(
            `SELECT * FROM pending_user_requests
             WHERE user_id = $1 AND status = 'pending'
             ORDER BY requested_at DESC
             LIMIT 1`,
            [userId]
        );

        if (!request) {
            return { success: false, message: 'Pending request not found' };
        }

        const authorized = await queryOne(
            `INSERT INTO authorized_users (user_id, username, chat_id, authorized_by, status)
             VALUES ($1, $2, $3, $4, 'active')
             ON CONFLICT (user_id) DO UPDATE SET
                username = EXCLUDED.username,
                chat_id = EXCLUDED.chat_id,
                authorized_by = EXCLUDED.authorized_by,
                status = 'active',
                authorized_at = now()
             RETURNING *`,
            [userId, request.username, request.chat_id, approvedBy]
        );

        await query(
            "UPDATE pending_user_requests SET status = 'approved' WHERE user_id = $1 AND status = 'pending'",
            [userId]
        );

        return {
            success: true,
            chatId: authorized.chat_id,
            username: authorized.username
        };
    } catch (error) {
        console.error('Error authorizing user:', error);
        return { success: false, message: 'Failed to authorize user' };
    }
}

/**
 * Reject user access
 */
export async function rejectUser(userId, rejectedBy) {
    try {
        const request = await queryOne(
            `UPDATE pending_user_requests SET status = 'rejected'
             WHERE user_id = $1 AND status = 'pending'
             RETURNING *`,
            [userId]
        );

        if (!request) {
            return { success: false, message: 'Pending request not found' };
        }

        return {
            success: true,
            chatId: request.chat_id,
            username: request.username
        };
    } catch (error) {
        console.error('Error rejecting user:', error);
        return { success: false, message: 'Pending request not found' };
    }
}

/**
 * Get all authorized user chat IDs
 */
export async function getAllAuthorizedUsers() {
    try {
        return await query(
            "SELECT chat_id, user_id, username FROM authorized_users WHERE status = 'active'"
        );
    } catch (error) {
        console.error('Error getting authorized users:', error);
        return [];
    }
}

/**
 * Get pending user requests
 */
export async function getPendingRequests() {
    try {
        return await query(
            "SELECT * FROM pending_user_requests WHERE status = 'pending' ORDER BY requested_at DESC"
        );
    } catch (error) {
        console.error('Error getting pending requests:', error);
        return [];
    }
}
