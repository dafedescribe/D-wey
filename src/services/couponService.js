const { supabase } = require('../config/database')
const UserService = require('./userService')

class CouponService {
    // ===================================================================
    // SAFE ATOMIC COUPON REDEMPTION - Complete implementation
    // ===================================================================
    
    static async redeemCoupon(phoneNumber, couponCode) {
        try {
            // ==================== VALIDATION ====================
            
            // Validate coupon format (basic validation)
            if (!couponCode || couponCode.length < 3) {
                throw new Error('Invalid coupon code format')
            }

            // Normalize coupon code
            const normalizedCode = couponCode.trim().toUpperCase()

            // ==================== USER REGISTRATION ====================
            
            // Soft register user if not exists (no email needed)
            await UserService.softRegisterUser(phoneNumber)
            
            const user = await UserService.getUserByPhone(phoneNumber)
            if (!user) {
                throw new Error('User registration failed')
            }

            // ==================== ATOMIC REDEMPTION ====================
            
            // Use safe atomic redemption function
            const { data, error } = await supabase.rpc('safe_redeem_coupon', {
                p_phone_number: phoneNumber,
                p_coupon_code: normalizedCode
            })

            if (error) {
                console.error('Database error:', error)
                throw new Error('Failed to redeem coupon. Please try again.')
            }

            const result = data[0]
            
            // ==================== HANDLE FAILURE ====================
            
            if (!result.success) {
                // Provide user-friendly error messages
                const errorMsg = this.formatErrorMessage(result.error_message)
                throw new Error(errorMsg)
            }

            // ==================== SUCCESS ====================
            
            console.log(`🎫 Coupon redeemed: ${phoneNumber} - ${normalizedCode} - ${result.coupon_amount} tums`)

            return {
                success: true,
                coupon: {
                    code: normalizedCode,
                    amount: result.coupon_amount,
                    description: `Redeemed ${result.coupon_amount} tums`
                },
                newBalance: result.new_balance,
                transaction: {
                    type: 'credit',
                    amount: result.coupon_amount,
                    description: `Coupon: ${normalizedCode}`,
                    timestamp: new Date().toISOString()
                }
            }

        } catch (error) {
            console.error('❌ Error redeeming coupon:', error.message)
            throw error
        }
    }

    // ===================================================================
    // FORMAT ERROR MESSAGES - User-friendly messages
    // ===================================================================
    
    static formatErrorMessage(dbError) {
        // Map database errors to user-friendly messages
        const errorMap = {
            'Invalid coupon code': 'Invalid coupon code. Check my status for valid coupons!',
            'This coupon has been disabled': 'This coupon is no longer valid. Check my status for new codes!',
            'This coupon has expired': 'This coupon has expired. Check my status for fresh codes!',
            'You already used this coupon': 'You already used this coupon. Check my status for new ones!',
            'This coupon has reached its limit': 'This coupon has reached its usage limit. Check my status for new codes!',
            'User not found': 'Account error. Please try again.'
        }

        return errorMap[dbError] || dbError
    }

    // ===================================================================
    // VALIDATE COUPON (without redeeming) - Check before attempting
    // ===================================================================
    
    static async validateCoupon(couponCode) {
        try {
            const { data: coupon, error } = await supabase
                .from('coupons')
                .select('*')
                .eq('code', couponCode.toUpperCase())
                .single()

            if (error) {
                if (error.code === 'PGRST116') {
                    return { 
                        valid: false, 
                        reason: 'Coupon not found',
                        message: 'Invalid coupon code. Check my status for valid coupons!'
                    }
                }
                throw error
            }

            // Check if valid
            if (!coupon.is_valid) {
                return { 
                    valid: false, 
                    reason: 'Coupon disabled',
                    message: 'This coupon is no longer valid.'
                }
            }

            // Check if expired
            if (coupon.expires_at && new Date(coupon.expires_at) < new Date()) {
                return { 
                    valid: false, 
                    reason: 'Coupon expired',
                    message: 'This coupon has expired. Check my status for fresh codes!'
                }
            }

            // Check usage limit (global)
            if (coupon.max_uses && coupon.used_count >= coupon.max_uses) {
                return { 
                    valid: false, 
                    reason: 'Usage limit reached',
                    message: 'This coupon has reached its usage limit.'
                }
            }

            return { 
                valid: true, 
                coupon: {
                    code: coupon.code,
                    amount: coupon.amount,
                    description: coupon.description,
                    remaining_uses: coupon.max_uses ? (coupon.max_uses - coupon.used_count) : 'Unlimited',
                    expires_at: coupon.expires_at
                }
            }

        } catch (error) {
            console.error('❌ Error validating coupon:', error.message)
            return { 
                valid: false, 
                reason: 'Validation error',
                message: 'Could not validate coupon. Please try again.'
            }
        }
    }

    // ===================================================================
    // GET USER COUPON HISTORY - Show user their redemptions
    // ===================================================================
    
    static async getUserCouponHistory(phoneNumber) {
        try {
            const user = await UserService.getUserByPhone(phoneNumber)
            if (!user || !user.transactions) return []

            // Filter only coupon transactions
            return user.transactions
                .filter(t => t.payment_method === 'coupon')
                .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
                .map(t => ({
                    code: t.coupon_code,
                    amount: t.tums_amount,
                    description: t.description,
                    redeemedAt: t.created_at
                }))

        } catch (error) {
            console.error('❌ Error getting coupon history:', error.message)
            return []
        }
    }

    // ===================================================================
    // CHECK IF USER USED SPECIFIC COUPON - Prevent duplicate attempts
    // ===================================================================
    
    static async hasUserUsedCoupon(phoneNumber, couponCode) {
        try {
            const { data: coupon, error } = await supabase
                .from('coupons')
                .select('used_by')
                .eq('code', couponCode.toUpperCase())
                .single()

            if (error) return false

            return coupon.used_by && coupon.used_by.includes(phoneNumber)

        } catch (error) {
            console.error('❌ Error checking coupon usage:', error.message)
            return false
        }
    }

    // ===================================================================
    // FORMAT COUPON INFO - Display-friendly coupon details
    // ===================================================================
    
    static formatCouponInfo(coupon) {
        const usageInfo = coupon.max_uses ? 
            `${coupon.used_count || 0}/${coupon.max_uses} used` : 
            `${coupon.used_count || 0} times used`

        const expiryInfo = coupon.expires_at ? 
            `Expires: ${new Date(coupon.expires_at).toLocaleDateString('en-GB', {
                timeZone: 'Africa/Lagos',
                day: '2-digit',
                month: 'short',
                year: 'numeric'
            })}` : 
            'No expiry'

        return {
            code: coupon.code,
            amount: coupon.amount,
            description: coupon.description || 'Tums coupon',
            usageInfo,
            expiryInfo,
            isValid: coupon.is_valid,
            isExpired: coupon.expires_at && new Date(coupon.expires_at) < new Date(),
            remainingUses: coupon.max_uses ? Math.max(0, coupon.max_uses - (coupon.used_count || 0)) : 'Unlimited'
        }
    }

    // ===================================================================
    // GET ACTIVE COUPONS - Admin/status feature
    // ===================================================================
    
    static async getActiveCoupons() {
        try {
            const { data: coupons, error } = await supabase
                .from('coupons')
                .select('*')
                .eq('is_valid', true)
                .order('created_at', { ascending: false })

            if (error) throw error

            // Filter out expired coupons
            const now = new Date()
            return (coupons || [])
                .filter(c => !c.expires_at || new Date(c.expires_at) > now)
                .filter(c => !c.max_uses || c.used_count < c.max_uses)
                .map(c => this.formatCouponInfo(c))

        } catch (error) {
            console.error('❌ Error getting active coupons:', error.message)
            return []
        }
    }

    // ===================================================================
    // ADMIN: CREATE COUPON - Generate new coupon codes
    // ===================================================================
    
    static async createCoupon({
        code,
        amount,
        description = null,
        maxUses = null,
        expiresAt = null
    }) {
        try {
            const { data, error } = await supabase
                .from('coupons')
                .insert([{
                    code: code.toUpperCase(),
                    amount: amount,
                    description: description,
                    max_uses: maxUses,
                    expires_at: expiresAt,
                    is_valid: true,
                    used_by: [],
                    used_count: 0,
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                }])
                .select()
                .single()

            if (error) {
                if (error.code === '23505') { // Duplicate key
                    throw new Error('Coupon code already exists')
                }
                throw error
            }

            console.log(`🎫 Coupon created: ${code} - ${amount} tums`)
            return { success: true, coupon: data }

        } catch (error) {
            console.error('❌ Error creating coupon:', error.message)
            throw error
        }
    }

    // ===================================================================
    // ADMIN: DISABLE COUPON - Deactivate a coupon
    // ===================================================================
    
    static async disableCoupon(couponCode) {
        try {
            const { error } = await supabase
                .from('coupons')
                .update({ 
                    is_valid: false,
                    updated_at: new Date().toISOString()
                })
                .eq('code', couponCode.toUpperCase())

            if (error) throw error

            console.log(`🎫 Coupon disabled: ${couponCode}`)
            return { success: true }

        } catch (error) {
            console.error('❌ Error disabling coupon:', error.message)
            throw error
        }
    }
}

module.exports = CouponService