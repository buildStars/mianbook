/** 注册页需要知道的选项：是否要填邮箱验证码 */
export default defineEventHandler(() => ({ emailCode: emailCodeRequired() }))
