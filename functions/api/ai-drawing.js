export async function onRequestPost({ request, env }) {
  try {
    if (!env.GEMINI_API_KEY) {
      return json({ 
        warning: 'GEMINI_API_KEY не задан в Cloudflare Pages',
        details: 'Settings → Environment variables → добавьте GEMINI_API_KEY (Secret). Затем redeploy.'
      }, 500);
    }

    const body = await request.json();
    const { data, mimeType, material, blankMass, detailMass, kim, qty } = body;

    if (!data || !material || !blankMass || !detailMass) {
      return json({ warning: 'Не хватает данных: нужны чертёж, марка стали и массы', rows: [] }, 400);
    }

    const prompt = `Ты — технолог-машиностроитель. Анализируешь чертёж детали и подбираешь нормы трудоёмкости.

НОРМАТИВНАЯ БАЗА:
"Справочник технолога-машиностроителя" под ред. А.Г. Косиловой и Р.К. Мещерякова (М.: Машиностроение, т.1 и т.2).

СТРОГИЕ ПРАВИЛА:
1. НЕЛЬЗЯ выдумывать нормы. Если не уверен — confidence < 50 и norm = 0.
2. Норма зависит от операции, оборудования, размеров обработки, марки стали. Нельзя использовать "н-ч/кг" как единственный критерий.
3. В поле source указывай конкретный раздел справочника: "Косилова, т.2, гл.4, табл.22" или "т.1, гл.3, стр.215".
4. Возвращай ТОЛЬКО валидный JSON без markdown-обёрток.
5. Если на чертеже нет данных — используй введённые пользователем массу и материал.
6. Операции пиши на русском, в соответствии с технологическим процессом: Заготовительная → Токарная черновая → Токарная чистовая → Фрезерная → Сверлильная → Шлифовальная → Термообработка → Слесарная → Контроль.

ВХОД:
- Марка стали: ${material}
- Масса заготовки: ${blankMass} кг
- Масса детали: ${detailMass} кг
- КИМ (коэффициент использования материала): ${kim.toFixed(4)}
- Количество: ${qty} шт

ФОРМАТ ОТВЕТА (строго JSON без комментариев):
{
  "summary": "краткое описание технологического маршрута (2-3 предложения)",
  "rows": [
    {
      "operation": "Токарная черновая",
      "parameters": "D=200 L=350",
      "norm": 0.45,
      "qty": 1,
      "confidence": 85,
      "source": "Косилова, т.2, гл.4, табл.22"
    }
  ]
}`;

    const response = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-goog-api-key': env.GEMINI_API_KEY
        },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: prompt },
              { inline_data: { mime_type: mimeType || 'image/jpeg', data: data.split(',')[1] } }
            ]
          }],
          generationConfig: {
            response_mime_type: 'application/json',
            temperature: 0.1
          }
        })
      }
    );

    if (!response.ok) {
      const err = await response.text();
      return json({ warning: 'Gemini API ошибка ' + response.status, details: err }, 500);
    }

    const aiResult = await response.json();
    const content = aiResult.candidates?.[0]?.content?.parts?.[0]?.text || '{}';

    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (e) {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
      else return json({ warning: 'Gemini вернул не-JSON', details: content.slice(0, 500) }, 500);
    }

    return json({
      summary: parsed.summary || 'Анализ выполнен',
      rows: Array.isArray(parsed.rows) ? parsed.rows : []
    });

  } catch (e) {
    return json({ warning: 'Ошибка сервера: ' + e.message, details: e.stack }, 500);
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    }
  });
}
