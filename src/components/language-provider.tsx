"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";

// English / Hindi labels for the parts of the app staff move around in:
// the menu, header, search, My work, Help and the tour. Each person picks the
// language for their own device (Settings, or the language button in the
// header); the choice is kept in this browser.

export type Language = "en" | "hi";

const STORAGE_KEY = "app-language";

const HINDI: Record<string, string> = {
  // Menu groups and items
  "My work": "मेरा काम",
  "Today": "आज",
  "Dashboard": "डैशबोर्ड",
  "Tasks": "टास्क",
  "Compliance": "कंप्लायंस",
  "Clients": "क्लाइंट",
  "Office": "ऑफिस",
  "Billing": "बिलिंग",
  "Admin": "एडमिन",
  "Users": "यूज़र",
  "Settings": "सेटिंग्स",
  "Help": "मदद",
  "Menu": "मेन्यू",
  "Log out": "लॉग आउट",
  // Header
  "Search": "खोजें",
  "Search clients, PAN, GSTIN, tasks, bills…": "क्लाइंट, PAN, GSTIN, टास्क, बिल खोजें…",
  "Refresh": "रीफ़्रेश",
  "Notifications": "सूचनाएं",
  "Keyboard shortcuts": "कीबोर्ड शॉर्टकट",
  "Language": "भाषा",
  "Good morning": "सुप्रभात",
  "Good afternoon": "नमस्कार",
  "Good evening": "शुभ संध्या",
  // My work
  "Everything waiting for you, from Tasks, Compliance and Billing.": "टास्क, कंप्लायंस और बिलिंग से आपका सारा बाकी काम।",
  "Overdue": "समय निकल गया",
  "Due today": "आज देय",
  "Due soon": "जल्द देय",
  "Open tasks": "खुले टास्क",
  "My tasks": "मेरे टास्क",
  "My compliance work": "मेरा कंप्लायंस काम",
  "Billing waiting for me": "मेरे पास बाकी बिलिंग",
  "Mark done": "पूरा करें",
  "Open": "खोलें",
  "Start": "शुरू करें",
  "Nothing waiting. Well done!": "कुछ बाकी नहीं। बहुत बढ़िया!",
  "No tasks assigned to you.": "आपको कोई टास्क नहीं दिया गया है।",
  "No compliance work due in the next 7 days.": "अगले 7 दिनों में कोई कंप्लायंस काम देय नहीं।",
  "Filed, waiting for files or steps": "फ़ाइल हो गया, फ़ाइलें या स्टेप बाकी",
  "New task": "नया टास्क",
  "Log work for billing": "बिलिंग के लिए काम दर्ज करें",
  "Undo": "वापस लें",
  // Help & tour
  "How to use the app": "ऐप कैसे इस्तेमाल करें",
  "Take the tour": "टूर देखें",
  "Next": "आगे",
  "Back": "पीछे",
  "Done": "हो गया",
  "Skip": "छोड़ें",
};

interface LanguageContextValue {
  language: Language;
  setLanguage: (language: Language) => void;
  t: (text: string) => string;
}

const LanguageContext = createContext<LanguageContextValue>({
  language: "en",
  setLanguage: () => {},
  t: (text) => text,
});

export const useLanguage = () => useContext(LanguageContext);

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<Language>("en");

  useEffect(() => {
    try {
      if (localStorage.getItem(STORAGE_KEY) === "hi") setLanguageState("hi");
    } catch {
      // Storage blocked: stay in English
    }
  }, []);

  const setLanguage = useCallback((next: Language) => {
    setLanguageState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Applies until the page is reloaded
    }
  }, []);

  // Text without a Hindi label stays in English
  const t = useCallback((text: string) => (language === "hi" ? HINDI[text] ?? text : text), [language]);

  return <LanguageContext.Provider value={{ language, setLanguage, t }}>{children}</LanguageContext.Provider>;
}
