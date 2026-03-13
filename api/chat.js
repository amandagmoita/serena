export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { action } = req.body;

    // ─── CLAUDE API ───
    if (action === 'chat') {
      const { model, max_tokens, system, messages } = req.body;
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: model || 'claude-sonnet-4-20250514',
          max_tokens: max_tokens || 1000,
          system,
          messages
        })
      });
      const data = await response.json();
      return res.status(200).json(data);
    }

    // ─── BODYGRAPH: LOCATIONS ───
    if (action === 'locations') {
      const { query } = req.body;
      const url = `https://api.bodygraphchart.com/v210502/locations?api_key=${process.env.BODYGRAPH_API_KEY}&query=${encodeURIComponent(query)}`;
      const response = await fetch(url);
      const data = await response.json();
      return res.status(200).json(data);
    }

    // ─── BODYGRAPH: HD DATA ───
    if (action === 'hd-data') {
      const { date, timezone } = req.body;
      const url = `https://api.bodygraphchart.com/v221006/hd-data?api_key=${process.env.BODYGRAPH_API_KEY}&date=${encodeURIComponent(date)}&timezone=${encodeURIComponent(timezone)}`;
      const response = await fetch(url);
      const data = await response.json();
      return res.status(200).json(data);
    }

    return res.status(400).json({ error: 'Invalid action' });
  } catch (error) {
    console.error('API error:', error);
    return res.status(500).json({ error: 'Server error' });
  }
}
