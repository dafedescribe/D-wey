const UserService = require('../services/userService')
const PaymentService = require('../services/paymentService')
const CouponService = require('../services/couponService')

function handleMessage(sock) {
    return async (m) => {
        const msg = m.messages[0]
        
        if (!msg?.message || 
            msg.key.remoteJid === 'status@broadcast' || 
            msg.key.fromMe) return

        if (m.type !== 'notify') return

        const text = msg.message?.conversation || 
                    msg.message?.extendedTextMessage?.text || ''
        
        const jid = msg.key.remoteJid
        const phoneNumber = jid.split('@')[0].replace(/\D/g, '')
        const displayName = msg.pushName || 'Friend'
        
        console.log(`📨 ${phoneNumber} (${displayName}): ${text}`)

        try {
            const command = text.toLowerCase().trim()

            // Rate limiting - simplified response
            const rateLimitCheck = UserService.checkRateLimit(phoneNumber, 'general')
            if (!rateLimitCheck.allowed) {
                await sock.sendMessage(jid, { 
                    text: `⚠️ Too fast! Wait ${rateLimitCheck.resetIn} seconds.` 
                })
                return
            }

            // EMAIL DETECTION - Simplified flow
            if (UserService.isValidEmail(text.trim())) {
                const emailRateCheck = UserService.checkRateLimit(phoneNumber, 'email')
                if (!emailRateCheck.allowed) {
                    await sock.sendMessage(jid, { text: `⚠️ Wait ${emailRateCheck.resetIn}s then try again.` })
                    return
                }

                const email = text.trim().toLowerCase()
                
                try {
                    const isEmailTaken = await UserService.isEmailTaken(email)
                    if (isEmailTaken) {
                        await sock.sendMessage(jid, { 
                            text: '❌ Email already used. Try a different one.' 
                        })
                        return
                    }

                    const result = await UserService.storeUserEmail(phoneNumber, displayName, email)
                    
                    if (result.isNew) {
                        // NEW USER - Super simple welcome
                        await sock.sendMessage(jid, { 
                            text: `✅ Welcome ${displayName}!\n🎁 You got 1000 free coins!\n💳 Want more? Send: pay 500` 
                        })
                    } else {
                        // RETURNING USER
                        if (result.user.email) {
                            await sock.sendMessage(jid, { 
                                text: `❌ Can't change email.\nYour email: ${result.user.email}\nSend "balance" to check coins.` 
                            })
                        } else {
                            await sock.sendMessage(jid, { 
                                text: `✅ Welcome back!\nBalance: ${result.user.wallet_balance || 0} coins\nSend "pay 500" to add more.` 
                            })
                        }
                    }
                } catch (error) {
                    await sock.sendMessage(jid, { text: '❌ Something broke. Try again.' })
                }
                return
            }

            // NATURAL LANGUAGE PROCESSING - Accept variations
            
            // BALANCE CHECK - Multiple ways to ask
            if (command.match(/(balance|money|coins|much.*have|check|wallet)/i)) {
                const user = await UserService.getUserByPhone(phoneNumber)
                
                if (!user || !user.email) {
                    await sock.sendMessage(jid, { 
                        text: '📧 Send your email first!\nExample: john@gmail.com' 
                    })
                    return
                }
                
                const balance = user.wallet_balance || 0
                await sock.sendMessage(jid, { 
                    text: `💰 ${balance} coins\n💳 Add more: pay 500` 
                })
                return
            }

            // PAYMENT INTENT - Multiple ways to express
            if (command.match(/(pay|buy|add|money|top.*up|purchase)/i) && !command.startsWith('/')) {
                const user = await UserService.getUserByPhone(phoneNumber)
                
                if (!user || !user.email) {
                    await sock.sendMessage(jid, { 
                        text: '📧 Send your email first to buy coins!' 
                    })
                    return
                }

                // Show simple payment options
                await sock.sendMessage(jid, { 
                    text: `💳 Buy coins with your card:\n\npay 500 → 2000 coins\npay 1000 → 4000 coins\npay 2000 → 8000 coins\n\nJust send "pay 500" to start!` 
                })
                return
            }

            // COUPON INTENT
            if (command.match(/(coupon|promo|code|free|bonus)/i) && !command.startsWith('/')) {
                const user = await UserService.getUserByPhone(phoneNumber)
                
                if (!user || !user.email) {
                    await sock.sendMessage(jid, { 
                        text: '📧 Send your email first!' 
                    })
                    return
                }

                await sock.sendMessage(jid, { 
                    text: `🎫 Got a coupon? Send:\ncoupon YOUR_CODE\n\nExample:\ncoupon SAVE100` 
                })
                return
            }

            // HELP/MENU REQUEST
            if (command.match(/(help|menu|commands|what|how|start|hi|hello)/i)) {
                const existingUser = await UserService.getUserByPhone(phoneNumber)
                
                if (existingUser && existingUser.email) {
                    await sock.sendMessage(jid, { 
                        text: `👋 Hey ${displayName}!\n\nbalance → Check coins\npay 500 → Buy coins\ncoupon ABC → Free coins\n\nThat's it! 🎯` 
                    })
                } else {
                    await sock.sendMessage(jid, { 
                        text: `👋 Hi ${displayName}!\n\nSend your email to start:\njohn@gmail.com\n\n🎁 Get 1000 free coins!` 
                    })
                }
                return
            }

            // EXACT PAYMENT COMMAND - pay 500
            if (command.startsWith('pay ')) {
                const payRateCheck = UserService.checkRateLimit(phoneNumber, 'payment')
                if (!payRateCheck.allowed) {
                    await sock.sendMessage(jid, { 
                        text: `💳 Wait ${payRateCheck.resetIn}s to prevent duplicate payments.` 
                    })
                    return
                }

                const user = await UserService.getUserByPhone(phoneNumber)
                
                if (!user || !user.email) {
                    await sock.sendMessage(jid, { 
                        text: '📧 Send your email first!' 
                    })
                    return
                }

                try {
                    const parts = command.split(' ')
                    if (parts.length < 2) {
                        await sock.sendMessage(jid, { 
                            text: `💳 How much?\n\nTry:\npay 500\npay 1000\npay 2000` 
                        })
                        return
                    }

                    const amountInKobo = PaymentService.parseAmount(parts[1])
                    const amountInNaira = amountInKobo / 100
                    const tumsToReceive = PaymentService.calculateCoins(amountInKobo)

                    const validation = PaymentService.validateCardPayment(amountInKobo)
                    if (!validation.isValid) {
                        await sock.sendMessage(jid, { 
                            text: `❌ ${validation.errors[0]}\nTry: pay 500` 
                        })
                        return
                    }

                    const payment = await PaymentService.createPaymentLink(
                        user.email, 
                        phoneNumber, 
                        amountInKobo
                    )

                    await sock.sendMessage(jid, { 
                        text: `💳 Pay ₦${amountInNaira} to get ${tumsToReceive} coins:\n\n${payment.authorization_url}\n\n✅ Instant credit after payment` 
                    })

                } catch (error) {
                    await sock.sendMessage(jid, { 
                        text: `❌ ${error.message}\nTry: pay 500` 
                    })
                }
                return
            }
            
            // EXACT COUPON COMMAND - coupon ABC123
            if (command.startsWith('coupon ')) {
                const couponRateCheck = UserService.checkRateLimit(phoneNumber, 'coupon')
                if (!couponRateCheck.allowed) {
                    await sock.sendMessage(jid, { 
                        text: `🎫 Wait ${couponRateCheck.resetIn}s before trying another coupon.` 
                    })
                    return
                }

                const parts = command.split(' ')
                if (parts.length < 2) {
                    await sock.sendMessage(jid, { 
                        text: `🎫 What's the code?\n\nTry:\ncoupon SAVE100` 
                    })
                    return
                }

                const couponCode = parts[1].trim().toUpperCase()
                
                try {
                    const result = await CouponService.redeemCoupon(phoneNumber, couponCode)
                    
                    await sock.sendMessage(jid, { 
                        text: `🎉 Coupon worked!\n\n+${result.coupon.amount} coins\nNew balance: ${result.newBalance} coins` 
                    })

                } catch (error) {
                    await sock.sendMessage(jid, { 
                        text: `❌ ${error.message}` 
                    })
                }
                return
            }
            
            // FALLBACK - Don't understand
            const user = await UserService.getUserByPhone(phoneNumber)
            if (!user || !user.email) {
                await sock.sendMessage(jid, { 
                    text: `📧 Send your email to get started!\nExample: john@gmail.com` 
                })
            } else {
                await sock.sendMessage(jid, { 
                    text: `🤔 Try:\n\nbalance\npay 500\ncoupon ABC\n\nOr just ask: "how much money do I have?"` 
                })
            }
            
        } catch (error) {
            console.error('❌ Error:', error)
            await sock.sendMessage(jid, { 
                text: '❌ Something broke. Try again in 1 minute.' 
            })
        }
    }
}

module.exports = { handleMessage }