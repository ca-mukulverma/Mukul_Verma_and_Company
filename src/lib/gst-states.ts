// GST state codes (the first two digits of a GSTIN) and their names. Used on
// bills and for a party's registrations in several states; nothing here
// touches the database, so the browser can use it too.

export const GST_STATES: Record<string, string> = {
  "01": "Jammu and Kashmir", "02": "Himachal Pradesh", "03": "Punjab", "04": "Chandigarh",
  "05": "Uttarakhand", "06": "Haryana", "07": "Delhi", "08": "Rajasthan", "09": "Uttar Pradesh",
  "10": "Bihar", "11": "Sikkim", "12": "Arunachal Pradesh", "13": "Nagaland", "14": "Manipur",
  "15": "Mizoram", "16": "Tripura", "17": "Meghalaya", "18": "Assam", "19": "West Bengal",
  "20": "Jharkhand", "21": "Odisha", "22": "Chhattisgarh", "23": "Madhya Pradesh", "24": "Gujarat",
  "26": "Dadra and Nagar Haveli and Daman and Diu", "27": "Maharashtra", "29": "Karnataka",
  "30": "Goa", "31": "Lakshadweep", "32": "Kerala", "33": "Tamil Nadu", "34": "Puducherry",
  "35": "Andaman and Nicobar Islands", "36": "Telangana", "37": "Andhra Pradesh", "38": "Ladakh",
  "97": "Other Territory",
};

export const GSTIN_PATTERN = /^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z0-9]Z[A-Z0-9]$/;

// "Maharashtra" for 27AAACM1234A1Z5; the code itself when it isn't known
export function gstState(gstin: string | null | undefined): string | null {
  if (!gstin || !/^\d{2}/.test(gstin)) return null;
  const code = gstin.slice(0, 2);
  return GST_STATES[code] ?? `State ${code}`;
}

// The PAN inside a GSTIN (characters 3 to 12)
export function panOfGstin(gstin: string | null | undefined): string | null {
  return gstin && gstin.length === 15 ? gstin.slice(2, 12).toUpperCase() : null;
}
