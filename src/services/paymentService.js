const https = require('https')
const { supabase } = require('../config/database')

class PaymentService {
    static async createPaymentLink(email, phoneNumber, amount = 1000) {
        const reference = `pay_${phoneNumber}_${Date.now()}`
        
        const postData = JSON.stringify({
            email: email,
            amount: amount * 100, // Paystack uses kobo
            reference: reference,
            callback_url: `https://api.whatsapp.com/send?phone=${process.env.BOT_PHONE_NUMBER}`
        })

        const options = {
            hostname: 'api.paystack.co',
            port: 443,
            path: '/transaction/initialize',
            method: 'POST',
            headers: {
                Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData)
            }
        }

        return new Promise((resolve, reject) => {
            const req = https.request(options, (res) => {
                let data = ''
                res.on('data', (chunk) => data += chunk)
                res.on('end', () => {
                    try {
                        const result = JSON.parse(data)
                        if (result.status) {
                            // Store payment reference in database
                            this.storePaymentReference(phoneNumber, reference, amount)
                            resolve({
                                authorization_url: result.data.authorization_url,
                                reference: reference
                            })
                        } else {
                            reject(new Error(result.message))
                        }
                    } catch (error) {
                        reject(error)
                    }
                })
            })
            
            req.on('error', reject)
            req.write(postData)
            req.end()
        })
    }

    static async storePaymentReference(phoneNumber, reference, amount) {
        try {
            await supabase
                .from('users')
                .update({
                    payment_reference: reference,
                    payment_status: 'pending',
                    amount_paid: amount,
                    updated_at: new Date().toISOString()
                })
                .eq('phone_number', phoneNumber)
        } catch (error) {
            console.error('❌ Error storing payment reference:', error.message)
        }
    }

    static async updatePaymentStatus(reference, status) {
        try {
            const { data, error } = await supabase
                .from('users')
                .update({
                    payment_status: status,
                    payment_date: status === 'success' ? new Date().toISOString() : null,
                    updated_at: new Date().toISOString()
                })
                .eq('payment_reference', reference)
                .select('phone_number, display_name')
                .single()

            if (error) throw error
            return data
        } catch (error) {
            console.error('❌ Error updating payment status:', error.message)
            return null
        }
    }

    static async verifyPayment(reference) {
        const options = {
            hostname: 'api.paystack.co',
            port: 443,
            path: `/transaction/verify/${reference}`,
            method: 'GET',
            headers: {
                Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`
            }
        }

        return new Promise((resolve, reject) => {
            const req = https.request(options, (res) => {
                let data = ''
                res.on('data', (chunk) => data += chunk)
                res.on('end', () => {
                    try {
                        const result = JSON.parse(data)
                        resolve(result)
                    } catch (error) {
                        reject(error)
                    }
                })
            })
            
            req.on('error', reject)
            req.end()
        })
    }
}

module.exports = PaymentService