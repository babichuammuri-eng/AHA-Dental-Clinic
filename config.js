// Clinic settings in one place. Change the numbers here, no other file needs to change.
module.exports = {
  // Shown on the website footer and on every receipt. Replace with the clinic's real details.
  clinic: {
    name: 'AHA Dental Clinic',
    tagline: 'Healthy teeth, easy smiles.',
    address: 'Bole Road, Addis Ababa, Ethiopia',
    phone: '+251 11 000 0000',
    email: 'info@ahadental.example',
    hours: 'Monday to Saturday, 9:00 to 17:00'
  },
  ledger: {
    currency: 'ETB',
    // Methods reception can record at the counter (online patients can use the methods under payment.methods).
    counterMethods: ['cash', 'telebirr', 'cbe', 'abyssinia']
  },
  deposit: {
    percent: 10,             // normal deposit: 10% of the estimated total
    min: 100,                // but never less than 100 ETB
    repeatNoShowPercent: 50, // patients with repeated no-shows pay 50%
    noShowThreshold: 2,      // how many no-shows count as "repeated"
    holdMinutes: 120         // an unpaid booking releases its slots after 2 hours
  },
  refundHoursBefore: 24,     // cancel at least 24 hours before to get the deposit back
  lookup: {
    allowReferenceOnly: true, // patient can check a booking with the reference number alone
    allowPhoneOnly: true      // phone number alone shows a view-only summary (no cancel, no payment)
  },
  limits: {
    maxUnpaidPerPhone: 2,     // open bookings waiting for a deposit, per phone number
    bookingsPerIpPerHour: 6   // booking requests per device per hour
  },
  // Replace the accounts below with the clinic's real ones.
  payment: {
    methods: [
      { id: 'telebirr', name: 'Telebirr', account: '0911 00 00 00', holder: 'AHA Dental Clinic',
        how: 'Open Telebirr, choose Send Money, enter the number above and the deposit amount.' },
      { id: 'cbe', name: 'Commercial Bank of Ethiopia', account: '1000 0000 00000', holder: 'AHA Dental Clinic',
        how: 'Use CBE Birr or mobile banking and transfer the deposit to the account above.' },
      { id: 'abyssinia', name: 'Abyssinia Bank', account: '0000 0000 0000', holder: 'AHA Dental Clinic',
        how: 'Use BoA mobile banking and transfer the deposit to the account above.' }
    ]
  }
};
