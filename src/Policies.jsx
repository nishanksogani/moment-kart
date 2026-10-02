export const POLICY_PAGES = {
  '/shipping': {
    title: 'Shipping & Delivery',
    intro: 'Made by hand, delivered with care. Shipping across India is included in the displayed product price.',
    sections: [
      ['Making your keepsake', 'Each piece is made to order. We dispatch orders within 10–15 days after payment confirmation and receipt of the personalisation details.'],
      ['Delivery and tracking', 'Delivery usually takes another 2–5 days after dispatch, depending on your PIN code and courier service. These are estimates; remote locations, holidays and courier delays may take longer. We email your courier name and tracking ID when the order ships, and show them in My Orders.'],
      ['Shipping charges', 'Shipping is included in the product price. No separate shipping charge is added at checkout.'],
      ['Your delivery details', 'Please provide a complete address, correct PIN code and reachable phone number. Contact us as soon as possible if an address needs correction; changes may not be possible after dispatch.'],
      ['A delayed or damaged parcel', 'If tracking stops updating or a parcel arrives damaged, keep the packaging and contact support with your order number, tracking ID and photos.']
    ]
  },
  '/returns': {
    title: 'Returns & Refunds',
    intro: 'If your keepsake arrives damaged or defective, we want to help put it right.',
    sections: [
      ['Report an issue', 'Contact support within 7 days of delivery with your order number, a description of the issue and clear photos of the product and packaging. Keep the item and packaging until we confirm the next steps.'],
      ['Replacement or refund', 'For damaged or defective items, we will review the issue and arrange a replacement or full refund. Please contact us before returning a parcel so we can provide return instructions.'],
      ['Personalised pieces', 'Personalised items cannot be returned for a change of mind, or for spelling or details supplied incorrectly at checkout. Items that arrive damaged or defective remain eligible for help. Natural differences in handmade colour swirls and small bubbles are described in our product information.'],
      ['Cancellation or changes', 'Contact support promptly to request cancellation or a change. Once making or personalisation has begun, changes may not be possible. We will explain what can be done for your specific order.'],
      ['Refund updates', 'Once a refund is agreed, support will confirm the amount, payment method and expected processing time. Keep your UPI transaction reference for payment enquiries.']
    ]
  },
  '/privacy': {
    title: 'Privacy Policy',
    intro: 'This page explains the information used to provide your account, personalise your keepsakes and fulfil your orders.',
    sections: [
      ['Information we collect', 'We store your account name, email address and a protected password hash; saved delivery addresses and phone numbers; order items, personalisation messages, UPI transaction references and order status; and reviews you choose to submit. We also record account activity such as the last login and operational error/security logs.'],
      ['How we use it', 'We use this information to verify your email, manage your account, confirm payments, make and ship orders, provide support and moderate reviews. Approved reviews display your account name and review text publicly.'],
      ['Services used to run the shop', 'The site uses Vercel for hosting, Neon for database storage and Gmail SMTP for email. Delivery information is shared with the courier as needed to deliver your parcel. External WhatsApp, Instagram and UPI apps handle information under their own policies when you use them.'],
      ['Browser storage', 'The browser stores your cart and login session in local storage so they remain available when you return. Signing out removes the active session; clearing browser storage also removes the saved local cart. The site loads fonts from Google Fonts.'],
      ['Keeping and managing your information', 'We keep information needed for your account, orders, support and business records. You can edit your name and saved addresses in My Profile. Contact support to request access, correction or deletion; we will explain any order or record information that must be retained.'],
      ['Emails and questions', 'Verification and shipping messages are service emails. Contact support about email preferences, marketing messages or privacy questions. Do not send passwords or verification codes in a support message.']
    ]
  },
  '/terms': {
    title: 'Terms of Service',
    intro: 'Please read these terms alongside the product information, shipping policy and returns policy before ordering.',
    sections: [
      ['Our products', 'Lagom.Dezign offers handmade resin keepsakes and personalised pieces. Read the product description, available sizes and care instructions. Handmade colour swirls and small details can vary between pieces and screen colours may differ from the finished item.'],
      ['Prices and payment', 'Prices are shown in Indian rupees and include shipping. Checkout checks current product prices and availability before displaying the payment QR. Payment is by UPI; submitting a transaction reference creates a pending order and does not itself confirm receipt of funds.'],
      ['Personalisation and order details', 'Check names, spelling, size, message, address and contact details carefully. You are responsible for the details you submit. Contact support promptly if you need a correction.'],
      ['Making and delivery', 'Orders normally dispatch in 10–15 days after payment confirmation and receipt of required details. Delivery estimates and shipping information appear on our Shipping & Delivery page.'],
      ['Issues, cancellation and refunds', 'Our Returns & Refunds page explains how to report damaged or defective items and request cancellation or changes. Contact support with your order number before sending anything back.'],
      ['Accounts and reviews', 'Keep login details private and provide accurate contact information. Submit reviews based on your experience and avoid including personal contact details. Reviews are moderated before publication.'],
      ['Support and updates', 'Contact us using the support details below for order questions or concerns. Updates to these pages will appear on the site; the policy applicable to an order should be retained with its order information. These terms do not exclude rights available under applicable law.']
    ]
  }
};

export default function PolicyPage({ path, contact, brand }) {
  const page = POLICY_PAGES[path];
  return <article className="page policy-page">
    <h1>{page.title}</h1><p className="policy-intro">{page.intro}</p>
    <div className="card policy-content">
      {page.sections.map(([title, text]) => <section key={title}><h2>{title}</h2><p>{text}</p></section>)}
      <section><h2>Contact {brand}</h2><p><a href={`mailto:${contact.email}`}>{contact.email}</a> · <a href={contact.whatsapp} target="_blank" rel="noreferrer">WhatsApp support</a></p></section>
    </div>
    <nav className="policy-links" aria-label="Shop policies">{Object.entries(POLICY_PAGES).map(([href, policy]) => <a key={href} href={href} aria-current={href === path ? 'page' : undefined}>{policy.title}</a>)}</nav>
  </article>;
}
