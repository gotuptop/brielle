// Planes de pago de Brielle. Los precios se crean directo en el Checkout (no hay que crear productos en Stripe).
// unit_amount está en centavos de dólar.
module.exports = {
  PLANS: {
    estudio:   { name: 'Studio / Estudio',     amount: 999,  credits: 20 },
    productor: { name: 'Producer / Productor', amount: 2499, credits: 60 },
  },
};
