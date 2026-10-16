/** 登录和注册页需要知道的选项：注册要不要填邮箱验证码、能不能用邮箱重置密码 */
export default defineEventHandler(() => ({ emailCode: emailCodeRequired(), passwordReset: mailConfigured() }))
