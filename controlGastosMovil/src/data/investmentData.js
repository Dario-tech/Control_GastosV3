// Definición estática de las inversiones
// prices se actualizan desde la API; el resto es tu configuración personal

export const INVESTMENTS = {
  longTerm: [
    {
      id: 'vwce',
      name: 'Vanguard FTSE All-World',
      ticker: 'VWCE.DE',
      type: 'ETF Global',
      emoji: '🌍',
      invested: 2800,      // € total aportado
      units: 20.5,         // participaciones que tienes
      avgBuyPrice: 136.58, // precio medio de compra
      apiSource: 'yahoo',
      apiSymbol: 'VWCE.DE',
      avSymbol:  'VWCE.DEX',
      color: '#5b7cff',
      description: 'Exposición a más de 3.700 empresas de 50 países',
    },
    {
      id: 'iwda',
      name: 'iShares Core MSCI World',
      ticker: 'IWDA.AS',
      type: 'ETF Mundo',
      emoji: '🏦',
      invested: 1600,
      units: 18.8,
      avgBuyPrice: 85.10,
      apiSource: 'yahoo',
      apiSymbol: 'IWDA.AS',
      avSymbol:  'IWDA.AMS',
      color: '#2dd4a0',
      description: 'Mercados desarrollados — 1.500 empresas',
    },
    {
      id: 'cspx',
      name: 'iShares Core S&P 500',
      ticker: 'CSPX.AS',
      type: 'ETF USA',
      emoji: '🇺🇸',
      invested: 1200,
      units: 5.1,
      avgBuyPrice: 235.29,
      apiSource: 'yahoo',
      apiSymbol: 'CSPX.AS',
      avSymbol:  'CSPX.AMS',
      color: '#ff9f43',
      description: 'Las 500 mayores empresas de Estados Unidos',
    },
    {
      id: 'btc',
      name: 'Bitcoin',
      ticker: 'BTC / EUR',
      type: 'Cripto',
      emoji: '₿',
      invested: 700,
      units: 0.0098,
      avgBuyPrice: 71428,
      apiSource: 'coingecko',
      apiId: 'bitcoin',
      color: '#f7931a',
      description: 'Reserva de valor digital descentralizada',
    },
  ],

  shortTerm: [
    {
      id: 'letras',
      name: 'Letras del Tesoro',
      ticker: 'ES Gov',
      type: 'Renta Fija',
      emoji: '🏛️',
      invested: 5000,
      units: 5000,         // valor nominal
      avgBuyPrice: 1.0,
      apiSource: 'static', // sin API pública
      staticPrice: 1.0,
      staticChange: 0,
      annualYield: 2.85,   // TIR anual aprox.
      maturity: '2025-12-15',
      color: '#a78bff',
      description: 'Deuda pública española a 12 meses · vence dic 2025',
    },
  ],

  pias: [
    {
      id: 'pias',
      name: 'PIAS Mapfre Crecimiento',
      ticker: 'PIAS',
      type: 'Seguro Ahorro',
      emoji: '🛡️',
      invested: 3600,      // prima total aportada
      currentValue: 3847,  // valor de rescate aproximado
      annualReturn: 3.2,   // rentabilidad anual media
      startDate: '2023-01-01',
      apiSource: 'static',
      color: '#ff5f7e',
      description: 'Plan Individual de Ahorro Sistemático · fiscalidad ventajosa',
      nextPremium: '2025-08-01',
      monthlyPremium: 100,
    },
  ],
}

// Datos de fallback para cuando las APIs fallen
export const FALLBACK_PRICES = {
  'VWCE.DE': { price: 142.30, change: 0.68 },
  'IWDA.AS': { price: 91.45,  change: 0.54 },
  'CSPX.AS': { price: 548.20, change: 1.12 },
  bitcoin:   { price: 88500,  change: 2.34 },
}
