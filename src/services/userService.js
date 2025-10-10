const { supabase } = require('../config/database')

class UserService {
    static rateLimitStorage = new Map()
    static RATE_LIMIT_WINDOW = 60000
    static MAX_REQUESTS_PER_MINUTE = 5
    static SIGNUP_BONUS = 1000

    // ===================================================================
    // RATE LIMITING (unchanged)
    // ===================================================================
    
    static checkRateLimit(phoneNumber, action = 'general') {
        const key = `${phoneNumber}_${action}`
        const now = Date.now()
        
        if (!this.rateLimitStorage.has(key)) {
            this.rateLimitStorage.set(key, { count: 1, resetTime: now + this.RATE_LIMIT_WINDOW })
            return { allowed: true, remaining: this.MAX_REQUESTS_PER_MINUTE - 1 }
        }
        
        const data = this.rateLimitStorage.get(key)
        
        if (now > data.resetTime) {
            this.rateLimitStorage.set(key, { count: 1, resetTime: now + this.RATE_LIMIT_WINDOW })
            return { allowed: true, remaining: this.MAX_REQUESTS_PER_MINUTE - 1 }
        }
        
        if (data.count >= this.MAX_REQUESTS_PER_MINUTE) {
            const resetIn = Math.ceil((data.resetTime - now) / 1000)
            return { 
                allowed: false, 
                remaining: 0, 
                resetIn,
                message: `⚠️ Rate limit exceeded. Wait ${resetIn} seconds.`
            }
        }
        
        data.count++
        return { allowed: true, remaining: this.MAX_REQUESTS_PER_MINUTE - data.count }
    }

    static cleanupRateLimit() {
        const now = Date.now()
        for (const [key, data] of this.rateLimitStorage.entries()) {
            if (now > data.resetTime) {
                this.rateLimitStorage.delete(key)
            }
        }
    }

    // ===================================================================
    // GET USER BY PHONE (unchanged)
    // ===================================================================
    
    static async getUserByPhone(phoneNumber) {
        try {
            const { data, error } = await supabase
                .from('users')
                .select('*')
                .eq('phone_number', phoneNumber)
                .single()

            if (error && error.code !== 'PGRST116') throw error
            return data
        } catch (error) {
            console.error('Error getting user:', error.message)
            return null
        }
    }

    // ===================================================================
    // SOFT REGISTER USER - UPDATED to use safe credit function
    // ===================================================================
    
    static async softRegisterUser(phoneNumber, displayName = null) {
        try {
            const existingUser = await this.getUserByPhone(phoneNumber)
            
            if (existingUser) {
                return { user: existingUser, isNew: false }
            }

            // Create new user WITHOUT signup bonus first
            const { data: newUser, error: createError } = await supabase
                .from('users')
                .insert([{
                    phone_number: phoneNumber,
                    display_name: displayName || `User_${phoneNumber.slice(-4)}`,
                    wallet_balance: 0,  // Start with 0
                    transactions: []
                }])
                .select()
                .single()

            if (createError) throw createError

            // Now add signup bonus using SAFE credit function
            const { data: creditResult, error: creditError } = await supabase
                .rpc('safe_credit_wallet', {
                    p_phone_number: phoneNumber,
                    p_amount: this.SIGNUP_BONUS,
                    p_description: `Welcome bonus - ${this.SIGNUP_BONUS} tums`,
                    p_payment_method: 'signup_bonus',
                    p_reference: `signup_${phoneNumber}_${Date.now()}`
                })

            if (creditError) {
                console.error('Error adding signup bonus:', creditError)
                // User is created but bonus failed - not critical
                // They can still use the service
            } else {
                const result = creditResult[0]
                if (result.success) {
                    console.log(`✅ New user registered: ${phoneNumber} - ${this.SIGNUP_BONUS} tums bonus added`)
                }
            }

            // Get updated user with bonus
            const updatedUser = await this.getUserByPhone(phoneNumber)
            
            return { 
                user: updatedUser || newUser, 
                isNew: true, 
                signupBonus: this.SIGNUP_BONUS 
            }

        } catch (error) {
            console.error('Error registering user:', error.message)
            throw error
        }
    }

    // ===================================================================
    // SAFE DEDUCT FROM WALLET - UPDATED to use database function
    // ===================================================================
    
    static async deductFromWallet(phoneNumber, tumsAmount, description = 'Purchase') {
        try {
            const { data, error } = await supabase.rpc('safe_deduct_wallet', {
                p_phone_number: phoneNumber,
                p_amount: tumsAmount,
                p_description: description,
                p_payment_method: 'purchase'
            })

            if (error) {
                console.error('Database error:', error)
                throw new Error('Failed to process payment. Please try again.')
            }

            const result = data[0]
            
            if (!result.success) {
                throw new Error(result.error_message)
            }

            console.log(`💳 Transaction: ${phoneNumber} - debit ${tumsAmount} tums - ${description}`)
            
            return { 
                success: true,
                newBalance: result.new_balance,
                transactionId: result.transaction_id,
                user: await this.getUserByPhone(phoneNumber)
            }
            
        } catch (error) {
            console.error('Error deducting from wallet:', error.message)
            throw error
        }
    }

    // ===================================================================
    // SAFE CREDIT WALLET - NEW function using database function
    // ===================================================================
    
    static async creditWallet(phoneNumber, tumsAmount, description = 'Credit', paymentMethod = 'manual', reference = null) {
        try {
            const { data, error } = await supabase.rpc('safe_credit_wallet', {
                p_phone_number: phoneNumber,
                p_amount: tumsAmount,
                p_description: description,
                p_payment_method: paymentMethod,
                p_reference: reference
            })

            if (error) {
                console.error('Database error:', error)
                throw new Error('Failed to credit wallet. Please try again.')
            }

            const result = data[0]
            
            if (!result.success) {
                throw new Error(result.error_message)
            }

            console.log(`💰 Transaction: ${phoneNumber} - credit ${tumsAmount} tums - ${description}`)
            
            return { 
                success: true,
                newBalance: result.new_balance,
                transactionId: result.transaction_id,
                user: await this.getUserByPhone(phoneNumber)
            }
            
        } catch (error) {
            console.error('Error crediting wallet:', error.message)
            throw error
        }
    }

    // ===================================================================
    // ADD TRANSACTION - DEPRECATED but kept for backward compatibility
    // ===================================================================
    
    /**
     * @deprecated Use deductFromWallet() or creditWallet() instead
     * This function is kept for backward compatibility only
     * It is NOT race-condition safe
     */
    static async addTransaction(phoneNumber, transaction) {
        try {
            console.warn('⚠️ addTransaction() is deprecated. Use deductFromWallet() or creditWallet() instead.')
            
            const user = await this.getUserByPhone(phoneNumber)
            if (!user) throw new Error('User not found')

            const currentTransactions = user.transactions || []
            const updatedTransactions = [transaction, ...currentTransactions]

            let newBalance = user.wallet_balance || 0
            if (transaction.type === 'credit') {
                newBalance += transaction.tums_amount
            } else if (transaction.type === 'debit') {
                newBalance -= transaction.tums_amount
            }

            const { data, error } = await supabase
                .from('users')
                .update({
                    wallet_balance: newBalance,
                    transactions: updatedTransactions,
                    updated_at: new Date().toISOString()
                })
                .eq('phone_number', phoneNumber)
                .select()
                .single()

            if (error) throw error
            
            console.log(`Transaction added: ${phoneNumber} - ${transaction.type} ${transaction.tums_amount} tums`)
            return { user: data, newBalance }
            
        } catch (error) {
            console.error('Error adding transaction:', error.message)
            throw error
        }
    }

    // ===================================================================
    // UPDATE WALLET BALANCE - Admin function (use with caution)
    // ===================================================================
    
    static async updateWalletBalance(phoneNumber, newBalance, reason = 'Admin adjustment') {
        try {
            const user = await this.getUserByPhone(phoneNumber)
            if (!user) throw new Error('User not found')

            const currentBalance = user.wallet_balance || 0
            const difference = newBalance - currentBalance

            if (difference === 0) {
                return { success: true, newBalance: currentBalance, message: 'No change needed' }
            }

            // Use safe credit/debit functions
            if (difference > 0) {
                // Credit the difference
                return await this.creditWallet(
                    phoneNumber, 
                    difference, 
                    reason, 
                    'admin_adjustment'
                )
            } else {
                // Debit the difference
                return await this.deductFromWallet(
                    phoneNumber, 
                    Math.abs(difference), 
                    reason
                )
            }
            
        } catch (error) {
            console.error('Error updating wallet:', error.message)
            throw error
        }
    }

    // ===================================================================
    // GET USER STATS - Useful for analytics
    // ===================================================================
    
    static async getUserStats(phoneNumber) {
        try {
            const user = await this.getUserByPhone(phoneNumber)
            if (!user) return null

            const transactions = user.transactions || []
            
            const totalCredits = transactions
                .filter(t => t.type === 'credit')
                .reduce((sum, t) => sum + t.tums_amount, 0)
            
            const totalDebits = transactions
                .filter(t => t.type === 'debit')
                .reduce((sum, t) => sum + t.tums_amount, 0)
            
            const couponRedemptions = transactions
                .filter(t => t.payment_method === 'coupon')
                .length
            
            const linkPurchases = transactions
                .filter(t => t.description && t.description.includes('Link created'))
                .length

            return {
                phoneNumber: user.phone_number,
                displayName: user.display_name,
                currentBalance: user.wallet_balance,
                totalCredits,
                totalDebits,
                totalTransactions: transactions.length,
                couponRedemptions,
                linkPurchases,
                accountCreated: user.created_at,
                lastActivity: user.updated_at
            }
            
        } catch (error) {
            console.error('Error getting user stats:', error.message)
            return null
        }
    }

    // ===================================================================
    // GET TRANSACTION HISTORY - Paginated
    // ===================================================================
    
    static async getTransactionHistory(phoneNumber, limit = 20, offset = 0) {
        try {
            const user = await this.getUserByPhone(phoneNumber)
            if (!user || !user.transactions) return []

            return user.transactions
                .slice(offset, offset + limit)
                .map(t => ({
                    id: t.id,
                    type: t.type,
                    amount: t.tums_amount,
                    description: t.description,
                    method: t.payment_method,
                    status: t.status,
                    reference: t.reference,
                    timestamp: t.created_at
                }))
            
        } catch (error) {
            console.error('Error getting transaction history:', error.message)
            return []
        }
    }

    // ===================================================================
    // BULK USER OPERATIONS - Admin functions
    // ===================================================================
    
    static async getAllUsers(limit = 100, offset = 0) {
        try {
            const { data, error } = await supabase
                .from('users')
                .select('phone_number, display_name, wallet_balance, created_at, updated_at')
                .order('created_at', { ascending: false })
                .range(offset, offset + limit - 1)

            if (error) throw error
            return data || []
            
        } catch (error) {
            console.error('Error getting all users:', error.message)
            return []
        }
    }

    static async getUserCount() {
        try {
            const { count, error } = await supabase
                .from('users')
                .select('*', { count: 'exact', head: true })

            if (error) throw error
            return count || 0
            
        } catch (error) {
            console.error('Error getting user count:', error.message)
            return 0
        }
    }

    static async getTotalWalletBalance() {
        try {
            const { data, error } = await supabase
                .from('users')
                .select('wallet_balance')

            if (error) throw error
            
            return (data || []).reduce((sum, user) => sum + (user.wallet_balance || 0), 0)
            
        } catch (error) {
            console.error('Error getting total wallet balance:', error.message)
            return 0
        }
    }
}

// Cleanup rate limit storage every 5 minutes
setInterval(() => {
    UserService.cleanupRateLimit()
}, 5 * 60 * 1000)

module.exports = UserService