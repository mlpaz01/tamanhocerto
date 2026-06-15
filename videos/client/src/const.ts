export { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";

// Self-hosted: o login é uma página local com e-mail/senha.
// BASE_URL respeita o prefixo de deploy (ex.: "/videos/").
export const getLoginUrl = () => `${import.meta.env.BASE_URL}login`;
