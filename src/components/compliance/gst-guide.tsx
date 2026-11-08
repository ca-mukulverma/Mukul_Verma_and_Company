"use client";

import { useEffect, useState } from "react";
import { BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useLanguage } from "@/components/language-provider";
import { cn } from "@/lib/utils";

// The staff guide for GST portal downloads: what to install on a computer,
// how to update it, the client's GST login, a download step by step, what
// each result means and what to do when something goes wrong. In English,
// Hindi and Hinglish; button names stay in English (as on screen). Opened
// from the GST portal box and from Help.

type GuideLanguage = "en" | "hi" | "hinglish";

interface GuideSection {
  title: string;
  intro?: string;
  steps?: string[];
  // Term → meaning, for the list of results
  terms?: [string, string][];
  note?: string;
}

const NAMES: Record<GuideLanguage, string> = { en: "English", hi: "हिंदी", hinglish: "Hinglish" };

const GUIDE: Record<GuideLanguage, { title: string; description: string; sections: GuideSection[] }> = {
  en: {
    title: "GST portal downloads: step-by-step guide",
    description: "Everything to install, and how to download a client's GST returns from the portal into the app.",
    sections: [
      {
        title: "1. What you need",
        steps: [
          "A computer with Google Chrome or Microsoft Edge. (Not a phone; not Firefox or Safari.)",
          "Your login to this app.",
          "The GST extension, installed once on that computer (section 2). Nothing else needs to be installed.",
          "The client's GST portal username and password saved in the app (section 4).",
        ],
      },
      {
        title: "2. Install the GST extension (once per computer)",
        steps: [
          "Open this app in Chrome or Edge. Go to Compliance → Clients, open any client with GST and scroll down to the GST portal box (below the GST working).",
          "Click Install the GST extension, then Download the extension. A file named mvc-gst-extension.zip is saved in your Downloads folder.",
          "Open the Downloads folder, right-click mvc-gst-extension.zip and choose Extract all → Extract. You get a folder named mvc-gst.",
          "Move the mvc-gst folder somewhere it will stay, for example Documents. Do not delete it later: Chrome runs the extension from this folder.",
          "In Chrome's address bar type chrome://extensions and press Enter. (In Edge: edge://extensions.)",
          "Turn on Developer mode (the switch at the top right; in Edge it is on the left side).",
          "Click Load unpacked, choose the mvc-gst folder and click Select folder.",
          "MV Company GST portal now appears in the list. Check its version number (for example 0.3.4).",
          "Go back to the app and reload the page (press F5). The GST portal box now shows the Download button and the extension's version.",
        ],
        note: "If Chrome shows a message about developer mode extensions when it starts, click Keep or close it. Do not turn the extension off.",
      },
      {
        title: "3. Update the GST extension (when the box asks)",
        intro: "When a new version is out, the GST portal box shows an amber note with the button Update the GST extension.",
        steps: [
          "Click Update the GST extension, then Download the new extension.",
          "Open your mvc-gst folder (for example in Documents) and delete everything inside it, including any mvc-gst folder inside it. Keep the empty mvc-gst folder itself.",
          "Right-click the new ZIP in Downloads → Extract all. As the folder, choose the folder that holds mvc-gst (for example Documents), not mvc-gst itself, and click Extract. If Windows asks, choose Replace the files in the destination.",
          "Open mvc-gst again: manifest.json, background.js, bridge.js, portal.js and relay.js must be directly inside it (not in another folder inside it).",
          "Open chrome://extensions (Edge: edge://extensions) and click the round reload arrow on MV Company GST portal. If it asks for a new permission (for example Manage your downloads), click Allow.",
          "Check the version number shown is the new one, then reload the app page (F5). The amber note goes away.",
        ],
        note: "Lost the old mvc-gst folder? In chrome://extensions click Remove on MV Company GST portal, then follow section 2 again from step 2.",
      },
      {
        title: "4. Save the client's GST login (once per client)",
        steps: [
          "Open the client (Clients → the client) and go to the Credentials tab.",
          "Click Add Credential.",
          "Title: write GST Portal (the title must contain the word GST, and must not be for e-way bill or e-invoice).",
          "Username/Email: the client's GST portal username. Password: the GST portal password.",
          "Click Save Credential.",
          "Also make sure the client's GSTIN is saved in the client's details.",
        ],
        note: "Without a saved login, the portal still opens, but you type the username and password yourself.",
      },
      {
        title: "5. Download a client's GST files",
        steps: [
          "Go to Compliance → Clients and open the client. Scroll to the GST portal box.",
          "Choose the financial year with the arrows at the top right of the box.",
          "Each month shows its files: Saved (green, already in the app), Missing (amber, ticked: will be fetched), Not due yet, and Only if filed (IFF, GSTR-1A: tick it yourself if it was filed).",
          "Check the ticks. Untick what you don't need; tick anything extra.",
          "Click Download N files from the GST portal. A GST portal tab opens next to the app with the username and password already filled in.",
          "In the portal tab, type the captcha and click LOGIN. Type the OTP if the portal asks for it.",
          "Go back to the app tab. Don't click anything in the portal tab while it works. The list under the button shows each file: Fetching…, then Saved.",
          "While it works, Chrome shows a bar at the top: \"MV Company GST portal started debugging this browser\". This is normal: Chrome itself is clicking the portal's buttons for you. Don't press Cancel on it; it goes away when the portal logs out.",
          "If the box shows \"Your turn: click … in the GST portal tab\" (for example if the bar was cancelled), go to the portal tab and click the button highlighted in orange. The extension then carries on by itself.",
          "Each file is saved through Upload documents, exactly as if you had dropped it there. The month boxes turn green.",
          "When the list is finished, the portal logs out and its tab closes by itself. You don't need to log out.",
        ],
        note: "One client at a time per browser. If the app tab is closed in the middle, the extension logs out of the portal by itself after 5 minutes.",
      },
      {
        title: "6. GSTR-1 JSON comes in two visits",
        steps: [
          "On the first download, the portal is asked to prepare the GSTR-1 JSON. The box shows JSON asked for.",
          "The portal takes about 20 minutes to prepare it. Meanwhile you can download other clients.",
          "After about 20 minutes, open the client again and click Download again. This time the JSON (all its parts) is fetched and saved.",
          "If it shows JSON not ready yet, wait a few more minutes and try again.",
        ],
      },
      {
        title: "7. What each result means",
        terms: [
          ["Saved", "The file is uploaded into the client's period. Nothing to do."],
          ["Got it; needs a look", "The file was fetched, but Upload documents held it back (the reason is shown, e.g. period locked, GSTIN differs, same file twice). Fix the highlighted row in Upload documents and upload from there."],
          ["Not filed on the portal", "The return is not filed on the portal yet (the portal offers Prepare / File instead of Download). Nothing was clicked. File the return first."],
          ["Not on the portal", "The portal has no such return for that month (for example the middle month of a quarterly filer). Usually nothing to do."],
          ["JSON asked for", "GSTR-1 JSON requested. Download again after about 20 minutes."],
          ["JSON not ready yet", "The portal is still preparing the JSON. Try again in a few minutes."],
          ["In Downloads", "The portal didn't let the extension read the file, so Chrome saved it in your Downloads folder. Drop that file into Upload documents."],
          ["Download by hand", "This file (GSTR-1A) is not handled yet. Download it on the portal and upload it."],
          ["Not fetched", "The run stopped (logout or session ended) before this file. Click Download again."],
          ["Error", "Something failed; the message says which page and step. Click Download again once. If it repeats, see section 8."],
        ],
      },
      {
        title: "8. If something goes wrong",
        steps: [
          "The box says Install the GST extension although you installed it: reload the app page (F5). Check chrome://extensions shows MV Company GST portal switched on.",
          "The box shows an amber update note: follow section 3.",
          "The GST portal is open for another client: click Log out there, then start again. Only one client at a time per browser.",
          "Stopped: the GST portal refused access (\"access denied\"): check the box shows extension 0.4.2 or newer (older ones were refused), update it if not (section 3), and try again later. Don't click Download again and again. If it repeats, click Save diagnostics (next to the extension version in the box) and send the file it saves to the admin.",
          "Nobody typed the captcha within 10 minutes: the portal tab closes by itself. Click Download again.",
          "Wrong captcha: the portal shows a new one; type it again (and the username and password too, if the portal cleared them).",
          "An error repeats for the same file: take a screenshot of the GST portal box showing that file's line and its full message, and send it to the admin with the client's name, month and return.",
        ],
      },
    ],
  },
  hi: {
    title: "GST पोर्टल डाउनलोड: स्टेप-बाय-स्टेप गाइड",
    description: "क्या इंस्टॉल करना है, और क्लाइंट के GST रिटर्न पोर्टल से ऐप में कैसे लाने हैं।",
    sections: [
      {
        title: "1. आपको क्या चाहिए",
        steps: [
          "Google Chrome या Microsoft Edge वाला कंप्यूटर। (फ़ोन नहीं; Firefox या Safari नहीं।)",
          "इस ऐप का आपका लॉगिन।",
          "GST एक्सटेंशन, उस कंप्यूटर पर एक बार इंस्टॉल (भाग 2)। इसके अलावा कुछ भी इंस्टॉल नहीं करना है।",
          "क्लाइंट का GST पोर्टल यूज़रनेम और पासवर्ड ऐप में सेव (भाग 4)।",
        ],
      },
      {
        title: "2. GST एक्सटेंशन इंस्टॉल करें (हर कंप्यूटर पर एक बार)",
        steps: [
          "यह ऐप Chrome या Edge में खोलें। Compliance → Clients में जाएँ, GST वाला कोई भी क्लाइंट खोलें और नीचे GST portal बॉक्स तक जाएँ (GST working के नीचे)।",
          "Install the GST extension पर क्लिक करें, फिर Download the extension पर। mvc-gst-extension.zip नाम की फ़ाइल Downloads फ़ोल्डर में सेव होगी।",
          "Downloads फ़ोल्डर खोलें, mvc-gst-extension.zip पर राइट-क्लिक करें और Extract all → Extract चुनें। mvc-gst नाम का फ़ोल्डर बन जाएगा।",
          "mvc-gst फ़ोल्डर को किसी पक्की जगह रखें, जैसे Documents में। इसे बाद में डिलीट न करें: Chrome एक्सटेंशन इसी फ़ोल्डर से चलाता है।",
          "Chrome के एड्रेस बार में chrome://extensions लिखें और Enter दबाएँ। (Edge में: edge://extensions)",
          "Developer mode चालू करें (ऊपर दाईं ओर का स्विच; Edge में यह बाईं ओर होता है)।",
          "Load unpacked पर क्लिक करें, mvc-gst फ़ोल्डर चुनें और Select folder पर क्लिक करें।",
          "अब लिस्ट में MV Company GST portal दिखेगा। उसका वर्ज़न नंबर देखें (जैसे 0.3.4)।",
          "ऐप पर वापस जाएँ और पेज रीलोड करें (F5 दबाएँ)। अब GST portal बॉक्स में Download बटन और एक्सटेंशन का वर्ज़न दिखेगा।",
        ],
        note: "अगर Chrome शुरू होते समय developer mode एक्सटेंशन के बारे में मैसेज दिखाए, तो Keep दबाएँ या उसे बंद कर दें। एक्सटेंशन को बंद (off) न करें।",
      },
      {
        title: "3. GST एक्सटेंशन अपडेट करें (जब बॉक्स कहे)",
        intro: "नया वर्ज़न आने पर GST portal बॉक्स में पीले रंग का नोट और Update the GST extension बटन दिखता है।",
        steps: [
          "Update the GST extension पर क्लिक करें, फिर Download the new extension पर।",
          "अपना mvc-gst फ़ोल्डर खोलें (जैसे Documents में) और उसके अंदर का सब कुछ डिलीट करें, अंदर कोई mvc-gst फ़ोल्डर हो तो वह भी। खाली mvc-gst फ़ोल्डर रहने दें।",
          "Downloads में नई ZIP पर राइट-क्लिक → Extract all। फ़ोल्डर के रूप में वह फ़ोल्डर चुनें जिसमें mvc-gst है (जैसे Documents), mvc-gst खुद नहीं, और Extract दबाएँ। Windows पूछे तो Replace the files in the destination चुनें।",
          "mvc-gst फिर खोलें: manifest.json, background.js, bridge.js, portal.js और relay.js सीधे उसी के अंदर होने चाहिए (अंदर किसी और फ़ोल्डर में नहीं)।",
          "chrome://extensions (Edge: edge://extensions) खोलें और MV Company GST portal पर गोल रीलोड तीर पर क्लिक करें। नई अनुमति माँगे (जैसे Manage your downloads) तो Allow दबाएँ।",
          "देखें कि नया वर्ज़न नंबर दिख रहा है, फिर ऐप का पेज रीलोड करें (F5)। पीला नोट हट जाएगा।",
        ],
        note: "पुराना mvc-gst फ़ोल्डर नहीं मिल रहा? chrome://extensions में MV Company GST portal पर Remove दबाएँ, फिर भाग 2 का स्टेप 2 से दोबारा करें।",
      },
      {
        title: "4. क्लाइंट का GST लॉगिन सेव करें (हर क्लाइंट के लिए एक बार)",
        steps: [
          "क्लाइंट खोलें (Clients → क्लाइंट) और Credentials टैब में जाएँ।",
          "Add Credential पर क्लिक करें।",
          "Title में GST Portal लिखें (टाइटल में GST शब्द होना ज़रूरी है, और यह e-way bill या e-invoice का न हो)।",
          "Username/Email में क्लाइंट का GST पोर्टल यूज़रनेम, और Password में GST पोर्टल पासवर्ड डालें।",
          "Save Credential पर क्लिक करें।",
          "यह भी देख लें कि क्लाइंट की डिटेल में GSTIN सेव है।",
        ],
        note: "लॉगिन सेव न हो तब भी पोर्टल खुलेगा, पर यूज़रनेम और पासवर्ड आपको खुद लिखना होगा।",
      },
      {
        title: "5. क्लाइंट की GST फ़ाइलें डाउनलोड करें",
        steps: [
          "Compliance → Clients में जाकर क्लाइंट खोलें। GST portal बॉक्स तक नीचे जाएँ।",
          "बॉक्स के ऊपर दाईं ओर के तीरों से वित्तीय वर्ष चुनें।",
          "हर महीने की फ़ाइलें दिखती हैं: Saved (हरा, ऐप में पहले से), Missing (पीला, टिक: लाई जाएगी), Not due yet (अभी देय नहीं), और Only if filed (IFF, GSTR-1A: फ़ाइल हुआ हो तो खुद टिक करें)।",
          "टिक देख लें। जो नहीं चाहिए उसका टिक हटाएँ; जो और चाहिए उस पर टिक लगाएँ।",
          "Download N files from the GST portal पर क्लिक करें। ऐप के बगल में GST पोर्टल का टैब खुलेगा, यूज़रनेम और पासवर्ड भरे हुए होंगे।",
          "पोर्टल टैब में कैप्चा लिखें और LOGIN दबाएँ। पोर्टल OTP माँगे तो OTP डालें।",
          "ऐप वाले टैब पर वापस आएँ। काम चलते समय पोर्टल टैब में कुछ भी क्लिक न करें। बटन के नीचे की लिस्ट में हर फ़ाइल दिखेगी: Fetching…, फिर Saved।",
          "काम चलते समय Chrome ऊपर एक पट्टी दिखाता है: \"MV Company GST portal started debugging this browser\"। यह सामान्य है: Chrome खुद आपके लिए पोर्टल के बटन क्लिक कर रहा है। इस पर Cancel न दबाएँ; पोर्टल लॉग आउट होने पर यह हट जाती है।",
          "अगर बॉक्स में \"Your turn: click … in the GST portal tab\" दिखे (जैसे पट्टी Cancel हो गई हो), तो पोर्टल टैब में जाकर नारंगी रंग से हाइलाइट हुआ बटन क्लिक करें। फिर एक्सटेंशन अपने आप आगे का काम करेगा।",
          "हर फ़ाइल Upload documents से सेव होती है, बिल्कुल वैसे ही जैसे आप खुद डालते। महीनों के बॉक्स हरे हो जाते हैं।",
          "लिस्ट पूरी होने पर पोर्टल अपने आप लॉग आउट हो जाता है और उसका टैब बंद हो जाता है। आपको लॉग आउट नहीं करना है।",
        ],
        note: "एक ब्राउज़र में एक समय में एक ही क्लाइंट। बीच में ऐप का टैब बंद हो जाए तो एक्सटेंशन 5 मिनट बाद पोर्टल से अपने आप लॉग आउट कर देता है।",
      },
      {
        title: "6. GSTR-1 JSON दो बार में आता है",
        steps: [
          "पहली बार डाउनलोड पर पोर्टल से GSTR-1 JSON तैयार करने को कहा जाता है। बॉक्स में JSON asked for दिखता है।",
          "पोर्टल इसे तैयार करने में लगभग 20 मिनट लेता है। तब तक आप दूसरे क्लाइंट डाउनलोड कर सकते हैं।",
          "लगभग 20 मिनट बाद क्लाइंट दोबारा खोलें और फिर से Download दबाएँ। इस बार JSON (उसके सभी पार्ट) आकर सेव हो जाएगा।",
          "अगर JSON not ready yet दिखे, तो कुछ मिनट और रुककर फिर कोशिश करें।",
        ],
      },
      {
        title: "7. हर नतीजे का मतलब",
        terms: [
          ["Saved", "फ़ाइल क्लाइंट के पीरियड में अपलोड हो गई। कुछ नहीं करना।"],
          ["Got it; needs a look", "फ़ाइल आ गई, पर Upload documents ने उसे रोक लिया (कारण लिखा होता है, जैसे पीरियड लॉक, GSTIN अलग, वही फ़ाइल दोबारा)। Upload documents में हाइलाइट हुई लाइन ठीक करें और वहीं से अपलोड करें।"],
          ["Not filed on the portal", "रिटर्न पोर्टल पर अभी फ़ाइल नहीं हुआ (पोर्टल Download की जगह Prepare / File दिखा रहा है)। कुछ भी क्लिक नहीं किया गया। पहले रिटर्न फ़ाइल करें।"],
          ["Not on the portal", "उस महीने का ऐसा रिटर्न पोर्टल पर नहीं है (जैसे तिमाही वाले क्लाइंट का बीच का महीना)। आमतौर पर कुछ नहीं करना।"],
          ["JSON asked for", "GSTR-1 JSON माँगा गया। लगभग 20 मिनट बाद फिर Download करें।"],
          ["JSON not ready yet", "पोर्टल अभी JSON तैयार कर रहा है। कुछ मिनट बाद फिर कोशिश करें।"],
          ["In Downloads", "पोर्टल ने एक्सटेंशन को फ़ाइल पढ़ने नहीं दी, इसलिए Chrome ने उसे आपके Downloads फ़ोल्डर में सेव किया। वह फ़ाइल Upload documents में डालें।"],
          ["Download by hand", "यह फ़ाइल (GSTR-1A) अभी अपने आप नहीं आती। पोर्टल से खुद डाउनलोड करके अपलोड करें।"],
          ["Not fetched", "इस फ़ाइल से पहले काम रुक गया (लॉग आउट या सेशन खत्म)। फिर से Download दबाएँ।"],
          ["Error", "कुछ गड़बड़ हुई; मैसेज में लिखा होता है कि किस पेज और स्टेप पर। एक बार फिर Download दबाएँ। फिर भी हो तो भाग 8 देखें।"],
        ],
      },
      {
        title: "8. कुछ गड़बड़ हो तो",
        steps: [
          "एक्सटेंशन इंस्टॉल करने के बाद भी बॉक्स में Install the GST extension दिख रहा है: ऐप का पेज रीलोड करें (F5)। chrome://extensions में देखें कि MV Company GST portal चालू (on) है।",
          "बॉक्स में पीला अपडेट नोट दिख रहा है: भाग 3 करें।",
          "The GST portal is open for another client दिखे: Log out there दबाएँ, फिर दोबारा शुरू करें। एक ब्राउज़र में एक समय में एक ही क्लाइंट।",
          "Stopped: the GST portal refused access (\"access denied\") दिखे: देखें कि बॉक्स में एक्सटेंशन 0.4.2 या नया दिख रहा है (पुराने वर्ज़न को पोर्टल मना करता था), नहीं तो अपडेट करें (भाग 3), और थोड़ी देर बाद फिर कोशिश करें। बार-बार Download न दबाएँ। फिर भी हो तो बॉक्स में एक्सटेंशन वर्ज़न के पास Save diagnostics दबाएँ और जो फ़ाइल सेव हो वह एडमिन को भेजें।",
          "10 मिनट में किसी ने कैप्चा नहीं लिखा: पोर्टल टैब अपने आप बंद हो जाता है। फिर से Download दबाएँ।",
          "कैप्चा गलत हुआ: पोर्टल नया कैप्चा दिखाएगा; दोबारा लिखें (पोर्टल ने यूज़रनेम और पासवर्ड मिटा दिए हों तो वे भी)।",
          "एक ही फ़ाइल पर बार-बार Error आए: GST portal बॉक्स में उस फ़ाइल की लाइन और पूरे मैसेज का स्क्रीनशॉट लें, और क्लाइंट का नाम, महीना और रिटर्न लिखकर एडमिन को भेजें।",
        ],
      },
    ],
  },
  hinglish: {
    title: "GST portal downloads: step-by-step guide",
    description: "Kya install karna hai, aur client ke GST returns portal se app mein kaise laane hain.",
    sections: [
      {
        title: "1. Aapko kya chahiye",
        steps: [
          "Google Chrome ya Microsoft Edge wala computer. (Phone nahi; Firefox ya Safari nahi.)",
          "Is app ka aapka login.",
          "GST extension, us computer par ek baar install (section 2). Iske alawa kuch bhi install nahi karna hai.",
          "Client ka GST portal username aur password app mein saved (section 4).",
        ],
      },
      {
        title: "2. GST extension install karein (har computer par ek baar)",
        steps: [
          "Yeh app Chrome ya Edge mein kholiye. Compliance → Clients mein jaaiye, GST wala koi bhi client kholiye aur neeche GST portal box tak scroll kariye (GST working ke neeche).",
          "Install the GST extension par click kariye, phir Download the extension par. mvc-gst-extension.zip naam ki file Downloads folder mein save hogi.",
          "Downloads folder kholiye, mvc-gst-extension.zip par right-click kariye aur Extract all → Extract chuniye. mvc-gst naam ka folder ban jaayega.",
          "mvc-gst folder ko kisi pakki jagah rakhiye, jaise Documents mein. Ise baad mein delete mat kariye: Chrome extension isi folder se chalata hai.",
          "Chrome ke address bar mein chrome://extensions likhiye aur Enter dabaiye. (Edge mein: edge://extensions)",
          "Developer mode ON kariye (upar right side ka switch; Edge mein yeh left side hota hai).",
          "Load unpacked par click kariye, mvc-gst folder chuniye aur Select folder dabaiye.",
          "Ab list mein MV Company GST portal dikhega. Uska version number dekhiye (jaise 0.3.4).",
          "App par wapas jaaiye aur page reload kariye (F5 dabaiye). Ab GST portal box mein Download button aur extension ka version dikhega.",
        ],
        note: "Agar Chrome start hote time developer mode extensions ka message dikhaye, to Keep dabaiye ya use band kar dijiye. Extension ko OFF mat kariye.",
      },
      {
        title: "3. GST extension update karein (jab box bole)",
        intro: "Naya version aane par GST portal box mein peela note aur Update the GST extension button dikhta hai.",
        steps: [
          "Update the GST extension par click kariye, phir Download the new extension par.",
          "Apna mvc-gst folder kholiye (jaise Documents mein) aur uske andar ka sab kuch delete kariye, andar koi mvc-gst folder ho to woh bhi. Khaali mvc-gst folder rehne dijiye.",
          "Downloads mein nayi ZIP par right-click → Extract all. Folder mein woh folder chuniye jismein mvc-gst hai (jaise Documents), mvc-gst khud nahi, aur Extract dabaiye. Windows pooche to Replace the files in the destination chuniye.",
          "mvc-gst phir kholiye: manifest.json, background.js, bridge.js, portal.js aur relay.js seedhe usi ke andar hone chahiye (andar kisi aur folder mein nahi).",
          "chrome://extensions (Edge: edge://extensions) kholiye aur MV Company GST portal par gol reload arrow par click kariye. Nayi permission maange (jaise Manage your downloads) to Allow dabaiye.",
          "Dekhiye ki naya version number dikh raha hai, phir app ka page reload kariye (F5). Peela note hat jaayega.",
        ],
        note: "Purana mvc-gst folder nahi mil raha? chrome://extensions mein MV Company GST portal par Remove dabaiye, phir section 2 ka step 2 se dobara kariye.",
      },
      {
        title: "4. Client ka GST login save karein (har client ke liye ek baar)",
        steps: [
          "Client kholiye (Clients → client) aur Credentials tab mein jaaiye.",
          "Add Credential par click kariye.",
          "Title mein GST Portal likhiye (title mein GST shabd hona zaroori hai, aur yeh e-way bill ya e-invoice ka na ho).",
          "Username/Email mein client ka GST portal username, aur Password mein GST portal password daaliye.",
          "Save Credential par click kariye.",
          "Yeh bhi check kar lijiye ki client ki details mein GSTIN saved hai.",
        ],
        note: "Login save na ho tab bhi portal khulega, par username aur password aapko khud likhna hoga.",
      },
      {
        title: "5. Client ki GST files download karein",
        steps: [
          "Compliance → Clients mein jaakar client kholiye. GST portal box tak scroll kariye.",
          "Box ke upar right side ke arrows se financial year chuniye.",
          "Har mahine ki files dikhti hain: Saved (green, app mein pehle se), Missing (peela, tick: laayi jaayegi), Not due yet (abhi due nahi), aur Only if filed (IFF, GSTR-1A: file hua ho to khud tick kariye).",
          "Ticks check kar lijiye. Jo nahi chahiye uska tick hataiye; jo aur chahiye us par tick lagaiye.",
          "Download N files from the GST portal par click kariye. App ke bagal mein GST portal ka tab khulega, username aur password bhare hue honge.",
          "Portal tab mein captcha likhiye aur LOGIN dabaiye. Portal OTP maange to OTP daaliye.",
          "App wale tab par wapas aaiye. Kaam chalte time portal tab mein kuch bhi click mat kariye. Button ke neeche ki list mein har file dikhegi: Fetching…, phir Saved.",
          "Kaam chalte time Chrome upar ek patti dikhata hai: \"MV Company GST portal started debugging this browser\". Yeh normal hai: Chrome khud aapke liye portal ke buttons click kar raha hai. Is par Cancel mat dabaiye; portal log out hone par yeh hat jaati hai.",
          "Agar box mein \"Your turn: click … in the GST portal tab\" dikhe (jaise patti Cancel ho gayi ho), to portal tab mein jaakar orange rang se highlight hua button click kariye. Phir extension apne aap aage ka kaam karega.",
          "Har file Upload documents se save hoti hai, bilkul waise hi jaise aap khud daalte. Mahino ke box green ho jaate hain.",
          "List poori hone par portal apne aap log out ho jaata hai aur uska tab band ho jaata hai. Aapko log out nahi karna hai.",
        ],
        note: "Ek browser mein ek time par ek hi client. Beech mein app ka tab band ho jaaye to extension 5 minute baad portal se apne aap log out kar deta hai.",
      },
      {
        title: "6. GSTR-1 JSON do baar mein aata hai",
        steps: [
          "Pehli baar download par portal se GSTR-1 JSON taiyaar karne ko kaha jaata hai. Box mein JSON asked for dikhta hai.",
          "Portal ise taiyaar karne mein lagbhag 20 minute leta hai. Tab tak aap doosre clients download kar sakte hain.",
          "Lagbhag 20 minute baad client dobara kholiye aur phir se Download dabaiye. Is baar JSON (uske saare parts) aakar save ho jaayega.",
          "Agar JSON not ready yet dikhe, to kuch minute aur rukkar phir try kariye.",
        ],
      },
      {
        title: "7. Har result ka matlab",
        terms: [
          ["Saved", "File client ke period mein upload ho gayi. Kuch nahi karna."],
          ["Got it; needs a look", "File aa gayi, par Upload documents ne use rok liya (reason likha hota hai, jaise period lock, GSTIN alag, wahi file dobara). Upload documents mein highlight hui line theek kariye aur wahin se upload kariye."],
          ["Not filed on the portal", "Return portal par abhi file nahi hua (portal Download ki jagah Prepare / File dikha raha hai). Kuch bhi click nahi kiya gaya. Pehle return file kariye."],
          ["Not on the portal", "Us mahine ka aisa return portal par nahi hai (jaise quarterly client ka beech ka mahina). Aam taur par kuch nahi karna."],
          ["JSON asked for", "GSTR-1 JSON maanga gaya. Lagbhag 20 minute baad phir Download kariye."],
          ["JSON not ready yet", "Portal abhi JSON taiyaar kar raha hai. Kuch minute baad phir try kariye."],
          ["In Downloads", "Portal ne extension ko file padhne nahi di, isliye Chrome ne use aapke Downloads folder mein save kiya. Woh file Upload documents mein daaliye."],
          ["Download by hand", "Yeh file (GSTR-1A) abhi apne aap nahi aati. Portal se khud download karke upload kariye."],
          ["Not fetched", "Is file se pehle kaam ruk gaya (log out ya session khatam). Phir se Download dabaiye."],
          ["Error", "Kuch gadbad hui; message mein likha hota hai ki kis page aur step par. Ek baar phir Download dabaiye. Phir bhi ho to section 8 dekhiye."],
        ],
      },
      {
        title: "8. Kuch gadbad ho to",
        steps: [
          "Extension install karne ke baad bhi box mein Install the GST extension dikh raha hai: app ka page reload kariye (F5). chrome://extensions mein dekhiye ki MV Company GST portal ON hai.",
          "Box mein peela update note dikh raha hai: section 3 kariye.",
          "The GST portal is open for another client dikhe: Log out there dabaiye, phir dobara shuru kariye. Ek browser mein ek time par ek hi client.",
          "Stopped: the GST portal refused access (\"access denied\") dikhe: check kariye ki box mein extension 0.4.2 ya naya dikh raha hai (purane version ko portal mana karta tha), nahi to update kariye (section 3), aur thodi der baad phir try kariye. Baar-baar Download mat dabaiye. Phir bhi ho to box mein extension version ke paas Save diagnostics dabaiye aur jo file save ho woh admin ko bhejiye.",
          "10 minute mein kisi ne captcha nahi likha: portal tab apne aap band ho jaata hai. Phir se Download dabaiye.",
          "Captcha galat hua: portal naya captcha dikhayega; dobara likhiye (portal ne username aur password mita diye hon to woh bhi).",
          "Ek hi file par baar-baar Error aaye: GST portal box mein us file ki line aur poore message ka screenshot lijiye, aur client ka naam, mahina aur return likhkar admin ko bhejiye.",
        ],
      },
    ],
  },
};

const STORAGE_KEY = "gst-guide-language";

function savedLanguage(): GuideLanguage | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === "en" || v === "hi" || v === "hinglish" ? v : null;
  } catch {
    return null;
  }
}

export function GstGuideDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { language: appLanguage } = useLanguage();
  const [language, setLanguage] = useState<GuideLanguage>("en");

  // The last choice in this browser, else the app's language
  useEffect(() => {
    if (open) setLanguage(savedLanguage() ?? (appLanguage === "hi" ? "hi" : "en"));
  }, [open, appLanguage]);

  const choose = (next: GuideLanguage) => {
    setLanguage(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Not remembered
    }
  };

  const guide = GUIDE[language];
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{guide.title}</DialogTitle>
          <DialogDescription>{guide.description}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Language">
          {(Object.keys(NAMES) as GuideLanguage[]).map((l) => (
            <Button key={l} size="sm" role="tab" aria-selected={language === l} variant={language === l ? "default" : "outline"} onClick={() => choose(l)}>
              {NAMES[l]}
            </Button>
          ))}
        </div>
        <div className="space-y-5 text-sm" lang={language === "hi" ? "hi" : "en"}>
          {guide.sections.map((section) => (
            <section key={section.title} className="space-y-2">
              <h3 className="text-base font-semibold">{section.title}</h3>
              {section.intro && <p className="text-muted-foreground">{section.intro}</p>}
              {section.steps && (
                <ol className="list-decimal space-y-1.5 pl-5">
                  {section.steps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
              )}
              {section.terms && (
                <dl className="divide-y rounded-md border">
                  {section.terms.map(([term, meaning]) => (
                    <div key={term} className="grid gap-1 p-2 sm:grid-cols-[11rem_1fr] sm:gap-3">
                      <dt className="font-medium">{term}</dt>
                      <dd className="text-muted-foreground">{meaning}</dd>
                    </div>
                  ))}
                </dl>
              )}
              {section.note && <p className="rounded-md bg-muted/60 p-2 text-xs text-muted-foreground">{section.note}</p>}
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// A button that opens the guide
export function GstGuideButton({ className, size = "sm", variant = "outline", label }: { className?: string; size?: "sm" | "default"; variant?: "outline" | "ghost" | "default"; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" size={size} variant={variant} className={cn(className)} onClick={() => setOpen(true)}>
        <BookOpen className="mr-1 h-4 w-4" /> {label ?? "Step-by-step guide (English / हिंदी / Hinglish)"}
      </Button>
      <GstGuideDialog open={open} onClose={() => setOpen(false)} />
    </>
  );
}
