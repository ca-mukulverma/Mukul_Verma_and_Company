// GST portal settings (docs/GST_PORTAL_EXTENSION_PLAN.md §7): everything the
// browser extension needs to know about the portal is data sent by the app
// with each run, never code in the extension, so a portal change is fixed by
// a deploy instead of reinstalling the extension on every PC. Stage 2 has one
// built-in version (addresses and login fields from the helper's selectors,
// to be checked in discovery); stage 6 keeps versions in the database.

// Something on a portal page. CSS for now; visible text comes with the
// click route (stage 3).
export interface PortalTarget {
  css: string;
}

export interface PortalSettings {
  version: number;
  urls: {
    login: string;
    // Regular expression (source) the address matches once logged in
    loggedIn: string;
    logout: string;
  };
  login: { username: PortalTarget; password: PortalTarget; captcha: PortalTarget };
  // Close the portal tab if nobody completes the login in this time
  loginWaitMinutes: number;
}

export const BUILT_IN_SETTINGS: PortalSettings = {
  version: 0,
  urls: {
    login: "https://services.gst.gov.in/services/login",
    // After the captcha (and OTP, where asked) the address has /services/auth/
    loggedIn: "^https://services\\.gst\\.gov\\.in/services/auth/",
    logout: "https://services.gst.gov.in/services/logout",
  },
  login: {
    username: { css: "#username" },
    password: { css: "#user_pass" },
    captcha: { css: "#captcha" },
  },
  loginWaitMinutes: 10,
};

export const activePortalSettings = (): PortalSettings => BUILT_IN_SETTINGS;
