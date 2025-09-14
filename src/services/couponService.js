const { supabase } = require('../config/database')
const UserService = require('./userService')

class CouponService {
    // Redeem coupon code
    static async redeemCoupon(phoneNumber, couponCode) {
        try {
            // Validate coupon format (basic validation)
            if (!couponCode || couponCode.length < 3) {
                throw new Error('Invalid coupon code format')
            }

            // Check if user exists
            const user = await UserService.getUserByPhone(phoneNumber)
            if (!user || !user.email) {
                throw new Error('Please register your email first before redeeming coupons')
            }

            // Get coupon from database
            const { data: coupon, error: couponError } = await supabase
                .from('coupons')
                .select('*')
                .eq('code', couponCode.toUpperCase())
                .single()

            if (couponError) {
                if (couponError.code === 'PGRST116') {
                    throw new Error('❌ Invalid coupon code')
                }
                throw couponError
            }

            // Check if coupon is valid
            if (!coupon.is_valid) {
                throw new Error('❌ This coupon has been disabled')
            }

            // Check if coupon is expired
            if (coupon.expires_at && new Date(coupon.expires_at) < new Date()) {
                throw new Error('❌ This coupon has expired')
            }

            // Check if user has already used this coupon
            if (coupon.used_by && coupon.used_by.includes(phoneNumber)) {
                throw new Error('❌ You have already used this coupon')
            }

            // Check usage limit
            if (coupon.max_uses && coupon.used_by && coupon.used_by.length >= coupon.max_uses) {
                throw new Error('❌ This coupon has reached its usage limit')
            }

            // Mark coupon as used by this user
            const updatedUsedBy = coupon.used_by ? [...coupon.used_by, phoneNumber] : [phoneNumber]
            
            const { error: updateError } = await supabase
                .from('coupons')
                .update({ 
                    used_by: updatedUsedBy,
                    used_count: (coupon.used_count || 0) + 1,
                    last_used_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                })
                .eq('code', couponCode.toUpperCase())

            if (updateError) throw updateError

            // Create coupon transaction
            const couponTransaction = {
                id: `txn_coupon_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                type: 'credit',
                payment_method: 'coupon',
                tums_amount: coupon.amount,
                naira_amount: 0,
                description: `Coupon redeemed: ${couponCode.toUpperCase()}`,
                status: 'completed',
                reference: `coupon_${couponCode.toUpperCase()}_${Date.now()}`,
                created_at: new Date().toISOString(),
                coupon_code: couponCode.toUpperCase()
            }

            // Add transaction and update wallet
            const result = await UserService.addTransaction(phoneNumber, couponTransaction)

            console.log(`🎫 Coupon redeemed: ${phoneNumber} - ${couponCode} - ${coupon.amount} tums`)

            return {
                success: true,
                coupon,
                newBalance: result.newBalance,
                transaction: couponTransaction
            }

        } catch (error) {
            console.error('❌ Error redeeming coupon:', error.message)
            throw error
        }
    }

    // Check if coupon is valid (without redeeming)
    static async validateCoupon(couponCode) {
        try {
            const { data: coupon, error } = await supabase
                .from('coupons')
                .select('*')
                .eq('code', couponCode.toUpperCase())
                .single()

            if (error) {
                if (error.code === 'PGRST116') {
                    return { valid: false, reason: 'Coupon not found' }
                }
                throw error
            }

            if (!coupon.is_valid) {
                return { valid: false, reason: 'Coupon disabled' }
            }

            if (coupon.expires_at && new Date(coupon.expires_at) < new Date()) {
                return { valid: false, reason: 'Coupon expired' }
            }

            if (coupon.max_uses && coupon.used_by && coupon.used_by.length >= coupon.max_uses) {
                return { valid: false, reason: 'Usage limit reached' }
            }

            return { valid: true, coupon }

        } catch (error) {
            console.error('❌ Error validating coupon:', error.message)
            return { valid: false, reason: 'Validation error' }
        }
    }

    // Get user's coupon usage history
    static async getUserCouponHistory(phoneNumber) {
        try {
            const user = await UserService.getUserByPhone(phoneNumber)
            if (!user || !user.transactions) return []

            return user.transactions
                .filter(t => t.payment_method === 'coupon')
                .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))

        } catch (error) {
            console.error('❌ Error getting coupon history:', error.message)
            return []
        }
    }

    // Check if user has used a specific coupon
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

    // Format coupon for display
    static formatCouponInfo(coupon) {
        const usageInfo = coupon.max_uses ? 
            `${coupon.used_count || 0}/${coupon.max_uses} used` : 
            `${coupon.used_count || 0} times used`

        const expiryInfo = coupon.expires_at ? 
            `Expires: ${new Date(coupon.expires_at).toLocaleDateString()}` : 
            'No expiry'

        return {
            code: coupon.code,
            amount: coupon.amount,
            description: coupon.description || 'Tums coupon',
            usageInfo,
            expiryInfo,
            isValid: coupon.is_valid
        }
    }
}

module.exports = CouponService