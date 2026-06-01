const SERVICE_CONFIG = {
  "MSME":               { color: "#1d4ed8", lightBg: "#eff6ff", accent: "#3b82f6", icon: "🏭", tagline: "Get official government recognition for your business", badge: "Business Registration" },
  "GST Registration":   { color: "#15803d", lightBg: "#f0fdf4", accent: "#22c55e", icon: "📋", tagline: "Register for GST and claim input tax credit", badge: "Tax Compliance" },
  "GST Return":         { color: "#b45309", lightBg: "#fefce8", accent: "#f59e0b", icon: "📊", tagline: "File timely returns and avoid penalties", badge: "Monthly Filing" },
  "Income Tax Return":  { color: "#7e22ce", lightBg: "#fdf4ff", accent: "#a855f7", icon: "💼", tagline: "Declare your income correctly and save on taxes", badge: "Annual Filing" },
  "Income Tax Audit":   { color: "#be123c", lightBg: "#fff1f2", accent: "#f43f5e", icon: "🔍", tagline: "Ensure compliance and stay protected from notices", badge: "Audit Services" },
  "Project Report":     { color: "#c2410c", lightBg: "#fff7ed", accent: "#f97316", icon: "📄", tagline: "Increase your bank loan approval chances", badge: "Loan Support" },
  "Subsidy Services":   { color: "#0f766e", lightBg: "#f0fdfa", accent: "#14b8a6", icon: "💰", tagline: "Get the full benefit of government schemes", badge: "Govt Benefits" },
  "Trade Mark":         { color: "#a21caf", lightBg: "#fdf2f8", accent: "#d946ef", icon: "™️", tagline: "Protect your brand identity legally", badge: "IP Protection" },
  "IEC Code":           { color: "#0369a1", lightBg: "#f0f9ff", accent: "#0ea5e9", icon: "🌐", tagline: "Expand your business into international markets", badge: "Export License" },
};
const DEFAULT_SERVICE_CONFIG = { color: "#4f46e5", lightBg: "#eef2ff", accent: "#6366f1", icon: "📦", tagline: "Take your business to the next level", badge: "Our Services" };
const DEFAULT_BENEFITS = [
  "Professionally manage your business operations",
  "Ensure full legal compliance at all times",
  "Build a strong foundation for future growth",
  "Get expert guidance from an experienced team",
];
const SERVICE_BENEFITS = {
  "MSME": [
    "Become eligible for government loans and subsidies",
    "Faster bank credit processing with MSME certificate",
    "Avail tax rebates and priority sector lending benefits",
    "Participate in international trade exhibitions and tenders",
  ],
  "GST Registration": [
    "Claim Input Tax Credit on purchased goods and services",
    "Conduct B2B dealings and work with large companies",
    "GST registration is mandatory for selling on e-commerce platforms",
    "Enhance brand credibility with a registered GSTIN number",
  ],
  "GST Return": [
    "Avoid penalties and late fees with timely filing",
    "Current returns are required to claim ITC refunds",
    "GST return history is required for bank loans",
    "Maintain a clean compliance record for future audits",
  ],
  "Income Tax Return": [
    "ITR serves as proof of income for visa applications",
    "ITR is mandatory for bank loans and credit card approvals",
    "Filing ITR is required to claim TDS refunds",
    "Carry forward business losses to future financial years",
  ],
  "Income Tax Audit": [
    "Audit is compulsory to avoid scrutiny notices",
    "Accurate financial statements are prepared through audit",
    "Errors and discrepancies are caught early in the audit process",
    "Investor confidence increases with audited financial accounts",
  ],
  "Project Report": [
    "Bank loan approval chances increase by up to 3x",
    "Mandatory document for subsidy applications",
    "Business plan is clearly defined for investors and lenders",
    "Prove eligibility for government schemes with a detailed report",
  ],
  "Subsidy Services": [
    "Get up to 50% subsidy on machinery purchases",
    "Reduce loan interest through interest subvention schemes",
    "Lower your working capital requirements significantly",
    "Receive free government funding for business expansion",
  ],
  "Trade Mark": [
    "No one can legally copy or misuse your brand",
    "Registered trademark significantly increases brand value",
    "Brand protection on all major e-commerce platforms",
    "Serves as the foundation for international trademark registration",
  ],
  "IEC Code": [
    "Legally start your import-export business operations",
    "Claim IGST refund on exports with an IEC code",
    "Deal directly with foreign buyers and international clients",
    "Claim government export incentives and schemes",
  ],
};
const generateServiceBanner = (service, config) => {
  const { color, accent, icon } = config;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="200" viewBox="0 0 600 200" style="display:block;border:0;outline:none;text-decoration:none;width:100%;height:auto;"><defs><linearGradient id="bg${service.replace(/\s/g, '')}" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" style="stop-color:${color};stop-opacity:1" /><stop offset="100%" style="stop-color:${accent};stop-opacity:1" /></linearGradient></defs><rect width="600" height="200" rx="12" fill="url(#bg${service.replace(/\s/g, '')})" /><circle cx="520" cy="30" r="80" fill="white" fill-opacity="0.06" /><circle cx="560" cy="120" r="100" fill="white" fill-opacity="0.05" /><circle cx="80" cy="170" r="60" fill="white" fill-opacity="0.07" /><circle cx="30" cy="40" r="40" fill="white" fill-opacity="0.05" /><circle cx="420" cy="60" r="2" fill="white" fill-opacity="0.2" /><circle cx="450" cy="60" r="2" fill="white" fill-opacity="0.2" /><circle cx="480" cy="60" r="2" fill="white" fill-opacity="0.2" /><circle cx="420" cy="90" r="2" fill="white" fill-opacity="0.2" /><circle cx="450" cy="90" r="2" fill="white" fill-opacity="0.2" /><circle cx="480" cy="90" r="2" fill="white" fill-opacity="0.2" /><circle cx="420" cy="120" r="2" fill="white" fill-opacity="0.2" /><circle cx="450" cy="120" r="2" fill="white" fill-opacity="0.2" /><circle cx="480" cy="120" r="2" fill="white" fill-opacity="0.2" /><rect x="40" y="50" width="80" height="80" rx="20" fill="white" fill-opacity="0.15" /><text x="80" y="105" text-anchor="middle" font-size="40" font-family="Apple Color Emoji, Segoe UI Emoji, sans-serif">${icon}</text><rect x="150" y="55" width="130" height="26" rx="13" fill="white" fill-opacity="0.2" /><text x="215" y="72" text-anchor="middle" font-size="11" font-weight="600" fill="white" font-family="Arial, sans-serif" letter-spacing="0.5">${config.badge.toUpperCase()}</text><text x="150" y="115" font-size="26" font-weight="700" fill="white" font-family="Arial, sans-serif">${service}</text><text x="150" y="142" font-size="13" fill="white" fill-opacity="0.85" font-family="Arial, sans-serif">${config.tagline}</text><text x="560" y="188" text-anchor="end" font-size="11" fill="white" fill-opacity="0.5" font-family="Arial, sans-serif">ShardaCRM</text></svg>`;
};

const buildCrossSellEmailTemplate = ({ leadName, originalService, recommendedService, pitch, customMessage, includeOtherServices, otherServices = [] }) => {
  const config = SERVICE_CONFIG[recommendedService] || DEFAULT_SERVICE_CONFIG;
  const origConfig = SERVICE_CONFIG[originalService] || DEFAULT_SERVICE_CONFIG;
  const benefits = SERVICE_BENEFITS[recommendedService] || DEFAULT_BENEFITS;
  const bannerSvg = generateServiceBanner(recommendedService, config);

  const otherServicesHtml = includeOtherServices && otherServices.length > 0
    ? `<tr><td style="padding:0 40px 32px;"><p style="margin:0 0 14px;font-size:13px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#64748b;">You may also be interested in</p><table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">${otherServices.map((s, i) => {
        const sc = SERVICE_CONFIG[s] || DEFAULT_SERVICE_CONFIG;
        return `<tr style="border-bottom:${i < otherServices.length - 1 ? "1px solid #f1f5f9" : "none"};"><td style="padding:14px 16px;"><table cellpadding="0" cellspacing="0"><tr><td style="padding-right:12px;font-size:20px;vertical-align:middle;">${sc.icon}</td><td><p style="margin:0;font-size:14px;font-weight:600;color:#1e293b;">${s}</p><p style="margin:2px 0 0;font-size:12px;color:#64748b;">${sc.tagline}</p></td><td style="text-align:right;vertical-align:middle;padding-left:12px;"><span style="display:inline-block;background:${sc.lightBg};color:${sc.color};font-size:11px;font-weight:600;padding:4px 10px;border-radius:20px;">${sc.badge}</span></td></tr></table></td></tr>`;
      }).join("")}</table></td></tr>`
    : "";

  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/><title>${recommendedService} — Special Offer for You</title></head><body style="margin:0;padding:0;background-color:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;"><table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 16px;"><tr><td align="center"><table width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;background:#ffffff;border-radius:20px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">

<tr><td style="background:${config.color};padding:12px 40px;"><table width="100%" cellpadding="0" cellspacing="0"><tr><td><p style="margin:0;font-size:13px;font-weight:700;color:white;letter-spacing:0.05em;">ShardaCRM</p></td><td align="right"><p style="margin:0;font-size:12px;color:rgba(255,255,255,0.7);">Specially curated for you</p></td></tr></table></td></tr>

<tr>
  <td style="padding:0;font-size:0;line-height:0;">
    <div style="display:block;width:100%;overflow:hidden;">
      ${bannerSvg}
    </div>
  </td>
</tr>

<tr><td style="padding:36px 40px 24px;">
  <p style="margin:0 0 8px;font-size:22px;font-weight:700;color:#0f172a;line-height:1.3;">Hello ${leadName}! 👋</p>
  <p style="margin:0;font-size:15px;color:#475569;line-height:1.6;">You had contacted us for <strong style="color:${origConfig.color};">${originalService}</strong>. To further strengthen your business journey, we have identified one more important service that could benefit you greatly.</p>
</td></tr>

<tr><td style="padding:0 40px;"><div style="height:1px;background:linear-gradient(to right,transparent,#e2e8f0,transparent);"></div></td></tr>

<tr><td style="padding:28px 40px;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:${config.lightBg};border-radius:16px;border:1.5px solid ${config.color}30;overflow:hidden;">
    <tr><td style="padding:24px;">
      <table cellpadding="0" cellspacing="0" style="margin-bottom:16px;"><tr><td style="background:${config.color};border-radius:20px;padding:5px 14px;"><p style="margin:0;font-size:11px;font-weight:700;color:white;letter-spacing:0.08em;text-transform:uppercase;">⭐ Recommended for You</p></td></tr></table>
      <p style="margin:0 0 12px;font-size:22px;font-weight:700;color:${config.color};">${config.icon} ${recommendedService}</p>
      <table width="100%" cellpadding="0" cellspacing="0"><tr><td style="background:white;border-radius:10px;padding:16px;border-left:3px solid ${config.color};">
        <p style="margin:0;font-size:14px;color:#334155;line-height:1.65;">💬 ${pitch}</p>
      </td></tr></table>
      ${customMessage ? `<p style="margin:16px 0 0;font-size:14px;color:#475569;line-height:1.6;">${customMessage}</p>` : ""}
    </td></tr>
  </table>
</td></tr>

<tr><td style="padding:0 40px 32px;">
  <p style="margin:0 0 14px;font-size:13px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#64748b;">Why should you choose this service?</p>
  <table width="100%" cellpadding="0" cellspacing="0">
    ${benefits.map((b, i) => `<tr><td style="padding:8px 0;${i < benefits.length - 1 ? "border-bottom:1px solid #f1f5f9;" : ""}"><table cellpadding="0" cellspacing="0"><tr><td style="vertical-align:top;padding-right:10px;"><div style="width:22px;height:22px;border-radius:50%;background:${config.lightBg};display:inline-flex;align-items:center;justify-content:center;"><span style="font-size:12px;color:${config.color};font-weight:700;">✓</span></div></td><td><p style="margin:0;font-size:14px;color:#334155;line-height:1.5;">${b}</p></td></tr></table></td></tr>`).join("")}
  </table>
</td></tr>

${otherServicesHtml}

<tr><td style="padding:0 40px 36px;">
  <table width="100%" cellpadding="0" cellspacing="0">
    <tr><td align="center"><table cellpadding="0" cellspacing="0"><tr><td style="background:${config.color};border-radius:12px;padding:14px 36px;"><p style="margin:0;font-size:16px;font-weight:700;color:white;">📞 Call Us Now — Free Consultation</p></td></tr></table></td></tr>
    <tr><td align="center" style="padding-top:12px;"><p style="margin:0;font-size:13px;color:#94a3b8;">Reply to this email or call us at: <strong style="color:#475569;">+91-XXXXXXXXXX</strong></p></td></tr>
  </table>
</td></tr>

<tr><td style="padding:0 40px;"><div style="height:1px;background:#f1f5f9;"></div></td></tr>

<tr><td style="padding:24px 40px;background:#f8fafc;border-radius:0 0 20px 20px;">
  <table width="100%" cellpadding="0" cellspacing="0"><tr>
    <td><p style="margin:0 0 4px;font-size:13px;font-weight:600;color:#334155;">ShardaCRM Team</p><p style="margin:0;font-size:12px;color:#94a3b8;">This email has been personally prepared for you.</p></td>
    <td align="right" style="vertical-align:top;"><p style="margin:0;font-size:22px;">${config.icon}</p></td>
  </tr></table>
</td></tr>

</table><p style="margin:16px 0 0;font-size:12px;color:#94a3b8;text-align:center;">© ${new Date().getFullYear()} ShardaCRM · Your business growth is our responsibility</p></td></tr></table></body></html>`;
};
export { SERVICE_CONFIG, DEFAULT_SERVICE_CONFIG, SERVICE_BENEFITS, DEFAULT_BENEFITS, buildCrossSellEmailTemplate };