import { supabase } from './database.js';
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
    const { data, error } = await supabase
        .from('authorized_users')
        .select('id')
        .eq('user_id', userId)
        .eq('status', 'active')
        .single();
    
    if (error && error.code !== 'PGRST116') { // PGRST116 = not found
        console.error('Error checking user authorization:', error);
        return false;
    }
    
    return !!data;
}

/**
 * Request user access - create pending request
 */
export async function requestUserAccess(userId, username, chatId) {
    // Check if already pending
    const { data: existing } = await supabase
        .from('pending_user_requests')
        .select('id')
        .eq('user_id', userId)
        .eq('status', 'pending')
        .single();
    
    if (existing) {
        return { success: false, message: 'Request already pending' };
    }
    
    // Check if already authorized
    const isAuthorized = await isUserAuthorized(userId);
    if (isAuthorized) {
        return { success: false, message: 'User already authorized' };
    }
    
    // Create pending request
    const { data, error } = await supabase
        .from('pending_user_requests')
        .insert({
            user_id: userId,
            username: username || null,
            chat_id: chatId,
            status: 'pending'
        })
        .select()
        .single();
    
    if (error) {
        console.error('Error creating pending request:', error);
        return { success: false, message: 'Failed to create request' };
    }
    
    return { success: true, requestId: data.id };
}

/**
 * Approve user access
 */
export async function approveUser(userId, approvedBy) {
    // Get pending request
    const { data: request, error: requestError } = await supabase
        .from('pending_user_requests')
        .select('*')
        .eq('user_id', userId)
        .eq('status', 'pending')
        .single();
    
    if (requestError || !request) {
        return { success: false, message: 'Pending request not found' };
    }
    
    // Add to authorized users
    const { data: authorized, error: authError } = await supabase
        .from('authorized_users')
        .insert({
            user_id: userId,
            username: request.username,
            chat_id: request.chat_id,
            authorized_by: approvedBy
        })
        .select()
        .single();
    
    if (authError) {
        console.error('Error authorizing user:', authError);
        return { success: false, message: 'Failed to authorize user' };
    }
    
    // Update pending request status
    await supabase
        .from('pending_user_requests')
        .update({ status: 'approved' })
        .eq('user_id', userId);
    
    return { 
        success: true, 
        chatId: authorized.chat_id,
        username: authorized.username 
    };
}

/**
 * Reject user access
 */
export async function rejectUser(userId, rejectedBy) {
    // Update pending request status
    const { data: request, error } = await supabase
        .from('pending_user_requests')
        .update({ status: 'rejected' })
        .eq('user_id', userId)
        .eq('status', 'pending')
        .select()
        .single();
    
    if (error || !request) {
        return { success: false, message: 'Pending request not found' };
    }
    
    return { 
        success: true, 
        chatId: request.chat_id,
        username: request.username 
    };
}

/**
 * Get all authorized user chat IDs
 */
export async function getAllAuthorizedUsers() {
    const { data, error } = await supabase
        .from('authorized_users')
        .select('chat_id, user_id, username')
        .eq('status', 'active');
    
    if (error) {
        console.error('Error getting authorized users:', error);
        return [];
    }
    
    return data || [];
}

/**
 * Get pending user requests
 */
export async function getPendingRequests() {
    const { data, error } = await supabase
        .from('pending_user_requests')
        .select('*')
        .eq('status', 'pending')
        .order('requested_at', { ascending: false });
    
    if (error) {
        console.error('Error getting pending requests:', error);
        return [];
    }
    
    return data || [];
}

