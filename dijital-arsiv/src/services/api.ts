import { createClient } from '@supabase/supabase-js';
import 'react-native-url-polyfill/auto';
import { Platform } from 'react-native';

const decodeSafeBase64 = (str: string): string => {
  if (!str) return '';
  if (str.startsWith('gsk_')) return str;
  try {
    if (typeof atob !== 'undefined') {
      return atob(str);
    }
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    let output = '';
    const cleanStr = str.replace(/[^A-Za-z0-9\+\/]/g, '');
    for (let i = 0, len = cleanStr.length; i < len; i += 4) {
      const enc1 = chars.indexOf(cleanStr.charAt(i));
      const enc2 = chars.indexOf(cleanStr.charAt(i + 1));
      const enc3 = chars.indexOf(cleanStr.charAt(i + 2));
      const enc4 = chars.indexOf(cleanStr.charAt(i + 3));
      const chr1 = (enc1 << 2) | (enc2 >> 4);
      const chr2 = ((enc2 & 15) << 4) | (enc3 >> 2);
      const chr3 = ((enc3 & 3) << 6) | enc4;
      output += String.fromCharCode(chr1);
      if (enc3 !== 64 && enc3 !== -1) output += String.fromCharCode(chr2);
      if (enc4 !== 64 && enc4 !== -1) output += String.fromCharCode(chr3);
    }
    return output;
  } catch (e) {
    return str;
  }
};

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
const SUPABASE_KEY = process.env.EXPO_PUBLIC_SUPABASE_KEY || '';
const GROQ_API_KEY = decodeSafeBase64(process.env.EXPO_PUBLIC_GROQ_API_KEY || '');
const OCR_API_KEY = decodeSafeBase64(process.env.EXPO_PUBLIC_OCR_API_KEY || '');

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

export interface AnalysisResult {
  title: string;
  amount: string;
  currency: string;
  date: string;
  category: string;
  summary: string;
  folder?: string;
}

export interface OCRResponse {
  status: string;
  message: string;
  data: {
    filename: string;
    text: string;
    category: string;
    currency: string;
  };
}

export const fetchInvoices = async () => {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData?.user?.id;

  let query = supabase
    .from('invoices')
    .select('*')
    .order('created_at', { ascending: false });

  if (userId) {
    query = query.eq('user_id', userId);
  }

  const { data, error } = await query;

  if (error) throw error;
  return data;
};

export const deleteInvoice = async (id: string) => {
  // Önce kaydı çek, fotoğraf URL'sini al
  const { data: record, error: fetchError } = await supabase
    .from('invoices')
    .select('image_url')
    .eq('id', id)
    .single();

  if (fetchError) throw fetchError;

  // Storage'daki fotoğrafı sil (varsa)
  if (record?.image_url) {
    const urls = record.image_url.split(',');
    for (const urlStr of urls) {
      if (!urlStr) continue;
      try {
        const url = new URL(urlStr);
        // URL yapısı: .../storage/v1/object/public/invoices/dosya_adi.jpg
        const parts = url.pathname.split('/storage/v1/object/public/invoices/');
        if (parts.length > 1) {
          const filePath = decodeURIComponent(parts[1]);
          const { error: storageError } = await supabase.storage
            .from('invoices')
            .remove([filePath]);
          if (storageError) {
            console.warn('Storage silme hatası:', storageError);
          } else {
            console.log('✅ Fotoğraf storage\'dan silindi:', filePath);
          }
        }
      } catch (e) {
        console.warn('Fotoğraf URL parse hatası:', e);
      }
    }
  }

  // Veritabanı kaydını sil
  const { error } = await supabase
    .from('invoices')
    .delete()
    .eq('id', id);

  if (error) throw error;
};

export const updateInvoiceDetails = async (id: string, updates: any) => {
  const { error } = await supabase
    .from('invoices')
    .update(updates)
    .eq('id', id);

  if (error) throw error;
};

export const appendImageToInvoice = async (id: string, currentImageUrl: string | null, base64: string, mimeType: string = 'image/jpeg') => {
  const { decode } = require('base64-arraybuffer');
  
  const safeFilename = `${Date.now()}_attachment.jpg`
    .replace(/[^a-zA-Z0-9_.-]/g, '');

  const { error: uploadError } = await supabase.storage
    .from('invoices')
    .upload(safeFilename, decode(base64), { contentType: mimeType, upsert: true });

  if (uploadError) throw uploadError;

  const { data: urlData } = supabase.storage
    .from('invoices')
    .getPublicUrl(safeFilename);

  const newUrl = urlData.publicUrl;
  const updatedImageUrl = currentImageUrl ? `${currentImageUrl},${newUrl}` : newUrl;

  const { error } = await supabase
    .from('invoices')
    .update({ image_url: updatedImageUrl })
    .eq('id', id);

  if (error) throw error;
  
  return updatedImageUrl;
};

export const uploadInvoice = async (
  uris: string[],
  filename: string,
  mimeType: string,
  category: string,
  documentType: 'warranty' | 'invoice' | 'vehicle' | 'konut' | 'kontrat' | 'kredi' | 'subscription' = 'warranty',
  finalText: string,
  base64Images: string[] = [],
  amount?: number,
  dueDate?: string,
  currency: string = 'TRY'
) => {
  let publicUrls: string[] = [];

  // 1. Fotoğraf varsa Supabase Storage'a yükle
  if (base64Images && base64Images.length > 0) {
    console.log('1. Fotoğraf(lar) buluta (Supabase Storage) yükleniyor...');
    const { decode } = require('base64-arraybuffer');

    for (let i = 0; i < base64Images.length; i++) {
      const base64 = base64Images[i];
      if (!base64) continue;

      // Dosya adını sanitize et
      const safeFilename = `${Date.now()}_${i}_${filename}`
        .replace(/[\s]/g, '_')
        .replace(/[ığüşöçİĞÜŞÖÇ]/g, (m) => {
          const map: Record<string, string> = {
            'ı': 'i', 'ğ': 'g', 'ü': 'u', 'ş': 's', 'ö': 'o', 'ç': 'c',
            'İ': 'I', 'Ğ': 'G', 'Ü': 'U', 'Ş': 'S', 'Ö': 'O', 'Ç': 'C'
          };
          return map[m] || m;
        })
        .replace(/[^a-zA-Z0-9_.-]/g, '');

      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('invoices')
        .upload(safeFilename, decode(base64), { contentType: mimeType, upsert: true });

      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage
        .from('invoices')
        .getPublicUrl(safeFilename);

      publicUrls.push(urlData.publicUrl);
    }
    console.log('✅ Fotoğraf(lar) başarıyla yüklendi:', publicUrls);
  }

  // 2. Veritabanına kaydet
  console.log('2. Veritabanına kaydediliyor...');

  // Tarih formatını dönüştür: GG.AA.YYYY -> YYYY-AA-GG
  let isoDate = null;
  if (dueDate && dueDate.includes('.')) {
    const [d, m, y] = dueDate.split('.');
    if (d && m && y) isoDate = `${y}-${m}-${d}`;
  } else {
    isoDate = dueDate || null;
  }

  const { data: userData } = await supabase.auth.getUser();
  const userId = userData?.user?.id;

  const { error: dbError } = await supabase
    .from('invoices')
    .insert([
      {
        user_id: userId,
        filename,
        image_url: publicUrls.length > 0 ? publicUrls.join(',') : null,
        raw_text: finalText,
        type: documentType,
        category,
        amount: amount || 0,
        due_date: isoDate,
        currency
      }
    ]);

  if (dbError) throw dbError;

  return {
    status: "success",
    message: "Belge başarıyla kaydedildi.",
    data: { filename, text: finalText, category, currency }
  };
};

export const addManualRecord = async (
  title: string,
  amount: string,
  date: string,
  category: string,
  type: string,
  description: string,
  currency: string = 'TRY'
) => {
  const numericAmount = parseTurkishNumber(amount);

  // GG.AA.YYYY -> YYYY-AA-GG
  const [d, m, y] = date.split('.');
  const isoDate = `${y}-${m}-${d}`;

  const { data: userData } = await supabase.auth.getUser();
  const userId = userData?.user?.id;

  const { error } = await supabase
    .from('invoices')
    .insert([
      {
        user_id: userId,
        filename: title,
        amount: numericAmount,
        due_date: isoDate,
        category,
        type,
        raw_text: description,
        currency
      }
    ]);

  if (error) throw error;
};

export const parseTurkishNumber = (val: string): number => {
  if (!val) return 0;
  // "1.250,50" -> 1250.50
  const cleaned = val.replace(/\./g, '').replace(',', '.');
  return parseFloat(cleaned) || 0;
};

export const fetchExchangeRates = async () => {
  try {
    const response = await fetch('https://api.exchangerate-api.com/v4/latest/TRY');
    const data = await response.json();
    return data.rates;
  } catch (error) {
    console.error("Döviz kurları alınamadı:", error);
    return null;
  }
};

export const analyzeDocument = async (uri: string, filename: string, mime: string, base64: string): Promise<AnalysisResult> => {
  if (!GROQ_API_KEY) throw new Error("Groq API anahtarı eksik");

  try {
    // Görsel boyutunu logla (Hata ayıklama için)
    const sizeInMB = (base64.length * (3 / 4)) / (1024 * 1024);
    console.log(`Analiz ediliyor: ${filename}, Boyut: ${sizeInMB.toFixed(2)} MB`);

    const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: "meta-llama/llama-4-scout-17b-16e-instruct",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `Sen profesyonel bir döküman analiz asistanısın. Bu dökümandan şu bilgileri ayıkla:
                1. title: Şirket adı veya döküman konusu.
                2. amount: Toplam tutar (Sayısal, nokta ondalık ayırıcı olmalı, para birimi sembolü OLMAMALI).
                3. currency: Para birimi (TRY, USD, EUR, GBP).
                4. date: İşlem tarihi (GG.AA.YYYY).
                5. category: En uygun kategori.
                6. summary: Detaylı Türkçe özet.
                7. folder: Belgenin içeriğine göre en uygun klasör adı (Örn: "Ev", "İş", "Kişisel", "Araç", "Eğitim", "Sağlık" vb.).

                Yanıtı yalnızca JSON formatında döndür.`
              },
              {
                type: "image_url",
                image_url: { url: `data:${mime};base64,${base64}` }
              }
            ]
          }
        ],
        temperature: 0.1
      })
    });

    if (!groqResponse.ok) {
      const errorText = await groqResponse.text();
      console.error("Groq API Hatası:", errorText);
      throw new Error(`API Hatası: ${groqResponse.status}`);
    }

    const groqData = await groqResponse.json();
    if (!groqData.choices || groqData.choices.length === 0) {
      throw new Error("API'den geçerli bir yanıt alınamadı.");
    }

    let content = groqData.choices[0].message.content;
    // JSON'ı Markdown bloklarından ayıkla (eğer varsa)
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      content = jsonMatch[0];
    }

    const result = JSON.parse(content);

    return {
      title: result.title || "",
      amount: result.amount || "",
      currency: result.currency || "TRY",
      date: result.date || "",
      category: result.category || "",
      summary: result.summary || "",
      folder: result.folder || ""
    };
  } catch (error) {
    console.error("Analiz Hatası Detayı:", error);
    throw error;
  }
};
