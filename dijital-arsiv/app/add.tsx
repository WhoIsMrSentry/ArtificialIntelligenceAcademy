import {
  View, Text, StyleSheet, Pressable, Image, ActivityIndicator,
  Alert, ScrollView, Dimensions, Platform, TextInput
} from 'react-native';
import { useState, useEffect } from 'react';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { uploadInvoice, addManualRecord, analyzeDocument, parseTurkishNumber } from '../src/services/api';
import { registerForPushNotificationsAsync, scheduleReminderNotification } from '../src/services/notifications';
import type { ReminderOption } from '../src/services/notifications';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { useTheme } from '../src/context/ThemeContext';
import { router, useLocalSearchParams } from 'expo-router';
import DateTimePicker from '@react-native-community/datetimepicker';

const { width } = Dimensions.get('window');

type DocType = 'warranty' | 'invoice' | 'vehicle' | 'konut' | 'kontrat' | 'kredi' | 'subscription';

interface DocTypeConfig {
  id: DocType;
  label: string;
  icon: string;
  colors: [string, string];
  color: string;
  categories?: string[];
  description: string;
  titleLabel: string;
  amountLabel: string;
  dateLabel: string;
}

const DOC_TYPES: DocTypeConfig[] = [
  {
    id: 'warranty', label: 'Garanti Belgesi', icon: 'shield-checkmark', colors: ['#6366f1', '#4338ca'], color: '#6366f1', 
    categories: ['Elektronik / Bilişim', 'Beyaz Eşya', 'Küçük Ev Aletleri', 'Mobilya / Dekorasyon', 'Giyim / Aksesuar', 'Oto Aksesuar / Parça', 'Spor / Outdoor', 'Diğer'], 
    description: 'Ürün garanti belgesi',
    titleLabel: 'Ürün Adı / Marka', amountLabel: 'Fatura Tutarı', dateLabel: 'Satın Alma Tarihi'
  },
  {
    id: 'invoice', label: 'Fatura / Fiş', icon: 'receipt', colors: ['#0ea5e9', '#0284c7'], color: '#0ea5e9', 
    categories: ['Elektrik', 'Su', 'Doğalgaz', 'İnternet / İletişim', 'Market / Mutfak', 'Sağlık / Eczane', 'Eğitim / Kurs', 'Seyahat / Konaklama', 'Eğlence / Etkinlik', 'Diğer'], 
    description: 'Fatura & gider belgesi',
    titleLabel: 'Kurum Adı', amountLabel: 'Fatura Tutarı', dateLabel: 'Son Ödeme / Fiş Tarihi'
  },
  {
    id: 'vehicle', label: 'Garajım', icon: 'car-sport', colors: ['#f59e0b', '#d97706'], color: '#f59e0b', categories: ['Servis / Bakım', 'MTV / Vergi', 'Kasko / Sigorta', 'Oto Aksesuar', 'Diğer'], description: 'Araç ile ilgili tüm belgeler',
    titleLabel: 'İşlem / Plaka', amountLabel: 'Tutar', dateLabel: 'İşlem Tarihi'
  },
  {
    id: 'konut', label: 'Konut Vergisi', icon: 'home', colors: ['#10b981', '#059669'], color: '#10b981', categories: ['Emlak Vergisi', 'DASK', 'Tapu Harcı', 'Diğer'], description: 'Konut & gayrimenkul vergisi',
    titleLabel: 'İlçe / Belediye', amountLabel: 'Vergi Tutarı', dateLabel: 'Son Ödeme Tarihi'
  },
  {
    id: 'kontrat', label: 'Kontrat', icon: 'document-text', colors: ['#8b5cf6', '#7c3aed'], color: '#8b5cf6', categories: ['Ev Sahibi', 'Kiracı', 'İş Sözleşmesi', 'Diğer'], description: 'Kira & sözleşme belgesi',
    titleLabel: 'Taraf / Kişi Adı', amountLabel: 'Aylık Bedel', dateLabel: 'Bitiş Tarihi'
  },
  {
    id: 'kredi', label: 'Borçlarım', icon: 'wallet', colors: ['#ef4444', '#dc2626'], color: '#ef4444', categories: ['Konut Kredisi', 'Taşıt Kredisi', 'İhtiyaç Kredisi', 'KYK Kredisi', 'Elden Borç', 'Diğer'], description: 'Kredi & borç belgesi',
    titleLabel: 'Banka / Kurum Adı', amountLabel: 'Tutar', dateLabel: 'Son Ödeme Tarihi'
  },
  {
    id: 'subscription', label: 'Abonelik', icon: 'repeat', colors: ['#ec4899', '#db2777'], color: '#ec4899', categories: ['Dijital Platform', 'Müzik', 'Yazılım / Bulut', 'Spor Salonu', 'Diğer'], description: 'Düzenli ödeme & abonelik',
    titleLabel: 'Hizmet / Platform Adı', amountLabel: 'Aylık Ücret', dateLabel: 'Yenileme Tarihi'
  }
];

export default function AddScreen() {
  const params = useLocalSearchParams();
  const initialType = (params.type as DocType) || 'warranty';
  const initialConfig = DOC_TYPES.find(d => d.id === initialType) || DOC_TYPES[0];

  const [images, setImages] = useState<string[]>([]);
  const [base64Images, setBase64Images] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [selectedDocType, setSelectedDocType] = useState<DocTypeConfig>(initialConfig);
  const [selectedCategory, setSelectedCategory] = useState<string>(initialConfig.categories?.[0] || 'Diğer');
  const [selectedReminders, setSelectedReminders] = useState<ReminderOption[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const { isDark } = useTheme();

  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(new Date());
  const [showDatePicker, setShowDatePicker] = useState(false);
  
  const [interestRate, setInterestRate] = useState('');
  const [months, setMonths] = useState('');
  const [principal, setPrincipal] = useState('');
  const [currency, setCurrency] = useState('TRY');
  const [folder, setFolder] = useState('');
  const [nextServiceDate, setNextServiceDate] = useState<Date | null>(null);
  const [showServicePicker, setShowServicePicker] = useState(false);

  const isDetailedCredit = selectedDocType.id === 'kredi' && ['Konut Kredisi', 'Taşıt Kredisi', 'İhtiyaç Kredisi', 'KYK Kredisi'].includes(selectedCategory);
  const isVehicleType = selectedDocType.id === 'vehicle';

  const resetForm = () => {
    setImages([]);
    setBase64Images([]);
    setResult(null);
    setTitle('');
    setAmount('');
    setDate(new Date());
    setFormattedDate(() => {
      const d = new Date();
      return `${d.getDate().toString().padStart(2, '0')}.${(d.getMonth() + 1).toString().padStart(2, '0')}.${d.getFullYear()}`;
    });
    setInterestRate('');
    setMonths('');
    setPrincipal('');
    setFolder('');
    setNextServiceDate(null);
    setSelectedReminders([]);
    setSelectedCategory(selectedDocType.categories?.[0] || 'Diğer');
  };

  // Kredi Hesaplama Mantığı
  useEffect(() => {
    if (isDetailedCredit && principal && interestRate && months) {
      // Virgüllü formatı sayıya çevir: "3.500,50" -> 3500.50
      const parseTr = (s: string) => parseFloat(s.replace(/\./g, '').replace(',', '.'));
      
      const p = parseTr(principal);
      const i = parseTr(interestRate) / 100; // Aylık faiz oranı
      const n = parseInt(months);
      
      if (p > 0 && i > 0 && n > 0) {
        const monthly = (p * i * Math.pow(1 + i, n)) / (Math.pow(1 + i, n) - 1);
        setAmount(monthly.toFixed(2).replace('.', ','));
      } else if (p > 0 && i === 0 && n > 0) {
        setAmount((p / n).toFixed(2).replace('.', ','));
      }
    }
  }, [principal, interestRate, months, isDetailedCredit]);

  const onChangeDate = (event: any, selectedDate?: Date) => {
    if (Platform.OS === 'android') setShowDatePicker(false);
    if (selectedDate) {
      setDate(selectedDate);
      setFormattedDate(
        `${selectedDate.getDate().toString().padStart(2, '0')}.${(selectedDate.getMonth() + 1).toString().padStart(2, '0')}.${selectedDate.getFullYear()}`
      );
    }
  };
  const [formattedDate, setFormattedDate] = useState(() => {
    const d = new Date();
    return `${d.getDate().toString().padStart(2, '0')}.${(d.getMonth() + 1).toString().padStart(2, '0')}.${d.getFullYear()}`;
  });

  // Kişiselleştirilmiş Çift Modlu Formatlayıcı
  const formatTurkishNumber = (val: string, isPercent = false) => {
    if (!val) return '';

    if (isPercent) {
      // FAİZ İÇİN: Otomatik Virgül (352 -> 3,52)
      let cleaned = val.replace(/\D/g, '');
      if (cleaned.length === 0) return '';
      if (cleaned.length <= 2) return `0,${cleaned.padStart(2, '0')}`;
      let integerPart = cleaned.slice(0, -2);
      let decimalPart = cleaned.slice(-2);
      return `${parseInt(integerPart)},${decimalPart}`;
    } else {
      // PARA İÇİN: Doğal Yazım + Binlik Noktası (15000 -> 15.000)
      // Noktayı virgüle çevir, diğer her şeyi temizle
      let cleaned = val.replace(/\./g, '').replace(/,/g, '#').replace(/[^0-9#]/g, '').replace(/#/g, ',');
      const parts = cleaned.split(',');
      let integerPart = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ".");
      let decimalPart = parts[1] !== undefined ? parts[1].slice(0, 2) : undefined;

      if (decimalPart !== undefined) return `${integerPart},${decimalPart}`;
      return integerPart;
    }
  };

  const standardToTurkish = (standardVal: string) => {
    if (!standardVal) return '';
    // "80100.00" -> "80.100,00"
    const parts = standardVal.replace(',', '').split('.');
    let integerPart = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    let decimalPart = parts[1] !== undefined ? parts[1].slice(0, 2) : undefined;
    
    if (decimalPart !== undefined) return `${integerPart},${decimalPart}`;
    return integerPart;
  };

  const getDynamicTitleLabel = () => {
    if (selectedDocType.id === 'kredi') {
      if (selectedCategory === 'Elden Borç') return 'Kişi Adı / Borçlu';
      if (selectedCategory === 'KYK Kredisi') return 'Öğrenim Kredisi / Kurum';
      return 'Banka Adı';
    }
    if (selectedDocType.id === 'kontrat') {
      if (selectedCategory === 'Ev Sahibi') return 'Ev Sahibi Adı';
      if (selectedCategory === 'Kiracı') return 'Kiracı Adı';
      if (selectedCategory === 'İş Sözleşmesi') return 'Firma / Şirket Adı';
      return 'Taraf / Kişi Adı';
    }
    return selectedDocType.titleLabel;
  };

  const getDynamicAmountLabel = () => {
    if (selectedDocType.id === 'kredi') {
      if (selectedCategory === 'Elden Borç') return 'Verilen / Alınan Tutar';
      if (selectedCategory === 'KYK Kredisi') return 'Aylık Ödeme Tutarı';
      return 'Aylık Taksit Tutarı';
    }
    if (selectedDocType.id === 'kontrat') {
      if (selectedCategory === 'İş Sözleşmesi') return 'Maaş / Ücret';
      return 'Aylık Bedel';
    }
    return selectedDocType.amountLabel;
  };

  const getDynamicDateLabel = () => {
    if (selectedDocType.id === 'kredi') {
      if (selectedCategory === 'Elden Borç') return 'Geri Ödeme Tarihi';
      if (selectedCategory === 'Kredi Kartı') return 'Son Ödeme Tarihi';
      return 'Taksit Ödeme Günü';
    }
    return selectedDocType.dateLabel;
  };

  const pickImage = async () => {
    let res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: false, allowsMultipleSelection: true, quality: 0.8, base64: true });
    if (!res.canceled) { 
        const newImages = res.assets.map(a => a.uri);
        const newBase64s = res.assets.map(a => a.base64 || '');
        setImages(prev => [...prev, ...newImages]); 
        setBase64Images(prev => [...prev, ...newBase64s]);
        setResult(null); 
        
        // Yapay zeka analizi sadece ilk resim için yap (eğer önceden resim yoksa)
        if (res.assets[0].base64 && images.length === 0) {
          handleAIAnalysis(res.assets[0].uri, res.assets[0].fileName || 'galeri_resim.jpg', 'image/jpeg', res.assets[0].base64);
        }
    }
  };

  const handleAIAnalysis = async (uri: string, filename: string, mime: string, base64: string) => {
    setIsAnalyzing(true);
    try {
      const data = await analyzeDocument(uri, filename, mime, base64);
      if (data.title) setTitle(data.title);
      if (data.amount) setAmount(standardToTurkish(data.amount.toString()));
      if (data.date) {
        setFormattedDate(data.date);
        const [d, m, y] = data.date.split('.').map(Number);
        if (!isNaN(d) && !isNaN(m) && !isNaN(y)) {
          setDate(new Date(y, m - 1, d));
        }
      }
      if (data.category && selectedDocType.categories?.includes(data.category)) {
        setSelectedCategory(data.category);
      }
      if (data.currency) setCurrency(data.currency);
      if (data.folder) setFolder(data.folder);
      setResult(data.summary);
    } catch (e) {
      console.warn("AI Analiz hatası:", e);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const takePhoto = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') { Alert.alert('Hata', 'Kamera izni gerekiyor.'); return; }
    let res = await ImagePicker.launchCameraAsync({ allowsEditing: false, quality: 0.5, base64: true });
    if (!res.canceled) { 
        const asset = res.assets[0];
        setImages(prev => [...prev, asset.uri]); 
        setBase64Images(prev => [...prev, asset.base64 || '']);
        setResult(null); 
        
        // Yapay zeka analizi başlat
        if (asset.base64 && images.length === 0) {
          handleAIAnalysis(asset.uri, 'kamera_resim.jpg', 'image/jpeg', asset.base64);
        }
    }
  };

  const handleSave = async () => {
    if (!title || !amount) {
      Alert.alert('Eksik Bilgi', `Lütfen ${getDynamicTitleLabel()} ve Tutar alanlarını doldurun.`);
      return;
    }
    setLoading(true);
    try {
      let additionalText = `Tutar: ${amount} ${currency}\n${getDynamicDateLabel()}: ${formattedDate}`;
      
      if (isDetailedCredit) {
         if (months) additionalText += `\nVade: ${months} Ay`;
         if (interestRate) additionalText += `\nFaiz Oranı: %${interestRate}`;
         if (principal) additionalText += `\nAnapara: ${principal} ${currency}`;
         additionalText += `\nAylık Taksit: ${amount} ${currency}`;
         const parseTr = (s: string) => parseFloat(s.replace(/\./g, '').replace(',', '.'));
         const totalRepayment = (parseTr(amount) * parseInt(months));
         additionalText += `\nToplam Geri Ödeme: ${totalRepayment.toFixed(2).replace('.', ',')} ${currency}`;
      }

      // Hatırlatma tercihlerini Türkçe olarak kaydet
      if (selectedReminders.length > 0) {
        const reminderLabels: Record<string, string> = {
          '1_minute': '1 Dakika',
          '1_week': '1 Hafta',
          '2_weeks': '2 Hafta',
          '3_weeks': '3 Hafta',
          '1_month': '1 Ay',
          '2_months': '2 Ay',
          '3_months': '3 Ay'
        };
        const turkishReminders = selectedReminders.map(r => reminderLabels[r] || r);
        additionalText += `\nHatırlatma: ${turkishReminders.join(', ')}`;
      }

      const triggerCalendarPrompt = (docTitle: string, docTypeLabel: string) => {
        Alert.alert(
          'Başarılı',
          'Belge kaydedildi! Bu belgeyi telefonunuzun takvimine hatırlatıcı olarak eklemek ister misiniz?',
          [
            { 
              text: 'Hayır', 
              style: 'cancel', 
              onPress: () => {
                resetForm();
                router.push('/');
              } 
            },
            { 
              text: 'Takvime Ekle', 
              style: 'default',
              onPress: () => {
                const encTitle = encodeURIComponent(`${docTitle} - Hatırlatma`);
                const encDetails = encodeURIComponent(`Dijital Arşiv: ${docTypeLabel}`);
                const [day, month, year] = formattedDate.split('.').map(Number);
                const tDate = new Date(year, month - 1, day);
                const formatGDate = (d: Date) => d.toISOString().replace(/-|:|\.\d\d\d/g,"").split('T')[0];
                const dateStr = formatGDate(tDate);
                const nextDayStr = formatGDate(new Date(tDate.getTime() + 24*60*60*1000));
                const gCalUrl = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encTitle}&details=${encDetails}&dates=${dateStr}/${nextDayStr}`;
                import('react-native').then(({ Linking }) => {
                  Linking.openURL(gCalUrl).catch(() => {}).finally(() => {
                    resetForm();
                    router.push('/');
                  });
                });
              }
            }
          ]
        );
      };

      if (images.length > 0 && base64Images.length > 0) {
        let finalDescription = result ? `${additionalText}\n\n--- YAPAY ZEKA ÖZETİ ---\n${result}` : additionalText;
        if (folder) finalDescription += `\n[FOLDER:${folder}]`;
        if (nextServiceDate) {
          const serviceIso = nextServiceDate.toISOString().split('T')[0];
          finalDescription += `\n[SERVICE:${serviceIso}]`;
        }
        const response = await uploadInvoice(
          images, 
          title, 
          'image/jpeg', 
          selectedCategory, 
          selectedDocType.id,
          finalDescription, 
          base64Images,
          parseTurkishNumber(amount),
          formattedDate,
          currency
        );
        
        // Tüm belge türleri için bildirim zamanla
        if (selectedReminders.length > 0 && Platform.OS !== 'web') {
           try {
             await registerForPushNotificationsAsync();
             const [day, month, year] = formattedDate.split('.').map(Number);
             const targetDate = new Date(year, month - 1, day);
             await scheduleReminderNotification(title, targetDate, selectedReminders, selectedDocType.label);
           } catch (e) {}
        }
        triggerCalendarPrompt(title, selectedDocType.label);
      } else {
        await addManualRecord(title, amount, formattedDate, selectedCategory, selectedDocType.id, additionalText, currency);
      
        // Tüm belge türleri için bildirim zamanla
        if (selectedReminders.length > 0 && Platform.OS !== 'web') {
           try {
             await registerForPushNotificationsAsync();
             const [day, month, year] = formattedDate.split('.').map(Number);
             const targetDate = new Date(year, month - 1, day);
             await scheduleReminderNotification(title, targetDate, selectedReminders, selectedDocType.label);
           } catch (e) {}
        }
        triggerCalendarPrompt(title, selectedDocType.label);
      }
    } catch (error: any) {
      Alert.alert('İşlem Başarısız', error.message || 'Bir hata oluştu.');
    } finally {
      setLoading(false);
    }
  };

  const handleSelectDocType = (cfg: DocTypeConfig) => {
    setSelectedDocType(cfg);
    setSelectedCategory(cfg.categories?.[0] || 'Diğer');
    setTitle('');
    setAmount('');
  };

  const bg: [string, string] = isDark ? ['#050505', '#0a0a1a'] : ['#f8fafc', '#f1f5f9'];

  return (
    <LinearGradient colors={bg} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>

        {/* Header */}
        <View style={styles.pageHeader}>
          <Pressable 
            onPress={() => router.push('/')}
            style={{ position: 'absolute', top: 0, left: 0, width: 44, height: 44, borderRadius: 22, backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)', justifyContent: 'center', alignItems: 'center', zIndex: 10 }}
          >
            <Ionicons name="arrow-back" size={24} color={isDark ? '#fff' : '#000'} />
          </Pressable>
          <LinearGradient colors={selectedDocType.colors} style={styles.iconCircle} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}>
            <Ionicons name={selectedDocType.icon as any} size={30} color="#fff" />
          </LinearGradient>
          <Text style={[styles.pageTitle, { color: isDark ? '#ffffff' : '#09090b' }]}>Yeni Kayıt Ekle</Text>
          <Text style={styles.pageDescription}>
            Manuel olarak girebilir veya yapay zeka ile fotoğraf taratabilirsiniz.
          </Text>
        </View>

        {/* Belge Türü Seçimi */}
        <Text style={styles.sectionTitle}>Belge Türü</Text>
        <View style={styles.docTypeGrid}>
          {DOC_TYPES.map(cfg => {
            const isActive = selectedDocType.id === cfg.id;
            return (
              <Pressable key={cfg.id} onPress={() => handleSelectDocType(cfg)} style={({pressed}) => [{ width: '48%', transform: [{ scale: pressed ? 0.95 : 1 }] }]}>
                {isActive ? (
                   <LinearGradient
                     colors={cfg.colors}
                     style={[styles.docTypeCardActive, { shadowColor: cfg.color }]}
                     start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                   >
                     <View style={styles.iconCircleWhite}>
                        <Ionicons name={cfg.icon as any} size={24} color={cfg.color} />
                     </View>
                     <Text style={styles.docTypeLabelActive}>{cfg.label}</Text>
                     <Text style={styles.docTypeDescActive}>{cfg.description}</Text>
                   </LinearGradient>
                ) : (
                   <BlurView intensity={isDark ? 20 : 50} tint={isDark ? "dark" : "light"} style={styles.docTypeCardInactiveBlur}>
                     <View style={[styles.docTypeCardInactiveInner, { borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)' }]}>
                        <View style={[styles.iconCircleDark, { backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)' }]}>
                           <Ionicons name={cfg.icon as any} size={24} color={isDark ? '#a1a1aa' : '#71717a'} />
                        </View>
                        <Text style={[styles.docTypeLabelInactive, { color: isDark ? '#d4d4d8' : '#3f3f46' }]}>{cfg.label}</Text>
                        <Text style={[styles.docTypeDescInactive, { color: isDark ? '#71717a' : '#a1a1aa' }]}>{cfg.description}</Text>
                     </View>
                   </BlurView>
                )}
              </Pressable>
            );
          })}
        </View>

        <View style={styles.formContainer}>
          <Text style={styles.inputLabel}>KLASÖR SEÇİMİ (OPSİYONEL)</Text>
          <View style={[styles.inputWrapper, { backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : '#ffffff', borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)' }]}>
            <Ionicons name="folder-outline" size={20} color="#6366f1" style={styles.inputIcon} />
            <TextInput
              style={[styles.input, { color: isDark ? '#ffffff' : '#000000' }]}
              placeholder="Örn: Ev, İş, Kişisel..."
              placeholderTextColor={isDark ? '#71717a' : '#a1a1aa'}
              value={folder}
              onChangeText={setFolder}
            />
          </View>

          <Text style={styles.inputLabel}>{getDynamicTitleLabel()}</Text>
          <View style={[styles.inputWrapper, { backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : '#ffffff', borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)' }]}>
            <Ionicons name="text-outline" size={20} color={isDark ? '#a1a1aa' : '#71717a'} style={styles.inputIcon} />
            <TextInput
              style={[styles.input, { color: isDark ? '#ffffff' : '#000000' }]}
              placeholder="..."
              placeholderTextColor={isDark ? '#71717a' : '#a1a1aa'}
              value={title}
              onChangeText={setTitle}
            />
          </View>

          <Text style={styles.inputLabel}>{isDetailedCredit ? 'Anapara (TL)' : getDynamicAmountLabel()}</Text>
          <View style={[styles.inputWrapper, { backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : '#ffffff', borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)' }]}>
            <Ionicons name="cash-outline" size={20} color={isDark ? '#a1a1aa' : '#71717a'} style={styles.inputIcon} />
            <TextInput
              style={[styles.input, { color: isDark ? '#ffffff' : '#000000' }]}
              placeholder="0,00"
              placeholderTextColor={isDark ? '#71717a' : '#a1a1aa'}
              keyboardType="decimal-pad"
              value={isDetailedCredit ? principal : amount}
              onChangeText={(val) => {
                const formatted = formatTurkishNumber(val);
                if (isDetailedCredit) setPrincipal(formatted);
                else setAmount(formatted);
              }}
            />
          </View>

          {/* Para Birimi Seçimi */}
          <Text style={styles.inputLabel}>Para Birimi</Text>
          <View style={{ flexDirection: 'row', gap: 8, marginBottom: 24 }}>
            {['TRY', 'USD', 'EUR', 'GBP'].map((cur) => (
              <Pressable
                key={cur}
                onPress={() => setCurrency(cur)}
                style={({ pressed }) => [
                  {
                    flex: 1,
                    paddingVertical: 10,
                    borderRadius: 12,
                    borderWidth: 1,
                    alignItems: 'center',
                    backgroundColor: currency === cur 
                      ? (isDark ? 'rgba(99,102,241,0.2)' : 'rgba(99,102,241,0.1)') 
                      : (isDark ? 'rgba(255,255,255,0.03)' : '#ffffff'),
                    borderColor: currency === cur ? '#6366f1' : (isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'),
                    opacity: pressed ? 0.7 : 1
                  }
                ]}
              >
                <Text style={{ 
                  color: currency === cur ? '#6366f1' : (isDark ? '#a1a1aa' : '#71717a'),
                  fontWeight: currency === cur ? '900' : '600',
                  fontSize: 13
                }}>{cur === 'TRY' ? '₺ TRY' : cur === 'USD' ? '$ USD' : cur === 'EUR' ? '€ EUR' : '£ GBP'}</Text>
              </Pressable>
            ))}
          </View>

          {isDetailedCredit && (
            <View style={{ flexDirection: 'row', gap: 12, marginBottom: 24 }}>
              <View style={{ flex: 1 }}>
                <Text style={styles.inputLabel}>Vade (Ay)</Text>
                <View style={[styles.inputWrapper, { marginBottom: 0, backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : '#ffffff', borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)' }]}>
                  <Ionicons name="time-outline" size={20} color={isDark ? '#a1a1aa' : '#71717a'} style={styles.inputIcon} />
                  <TextInput
                    style={[styles.input, { color: isDark ? '#ffffff' : '#000000' }]}
                    placeholder="36"
                    placeholderTextColor={isDark ? '#71717a' : '#a1a1aa'}
                    keyboardType="decimal-pad"
                    value={months}
                    onChangeText={setMonths}
                  />
                </View>
              </View>

              <View style={{ flex: 1 }}>
                <Text style={styles.inputLabel}>Faiz (%)</Text>
                <View style={[styles.inputWrapper, { marginBottom: 0, backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : '#ffffff', borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)' }]}>
                  <Ionicons name="stats-chart-outline" size={20} color={isDark ? '#a1a1aa' : '#71717a'} style={styles.inputIcon} />
                  <TextInput
                    style={[styles.input, { color: isDark ? '#ffffff' : '#000000' }]}
                    placeholder="0,00"
                    placeholderTextColor={isDark ? '#71717a' : '#a1a1aa'}
                    keyboardType="decimal-pad"
                    value={interestRate}
                    onChangeText={(val) => setInterestRate(formatTurkishNumber(val, true))}
                  />
                </View>
              </View>
            </View>
          )}

          {isDetailedCredit && amount !== '' && (
            <BlurView intensity={20} tint={isDark ? "dark" : "light"} style={{ padding: 16, borderRadius: 16, marginBottom: 24, borderWidth: 1, borderColor: '#6366f133' }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 }}>
                <View>
                  <Text style={{ color: '#6366f1', fontWeight: '800', fontSize: 10, textTransform: 'uppercase', marginBottom: 4 }}>Aylık Taksit</Text>
                  <Text style={{ color: isDark ? '#fff' : '#000', fontSize: 20, fontWeight: '900' }}>{parseFloat(amount).toLocaleString('tr-TR')} TL</Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={{ color: '#10b981', fontWeight: '800', fontSize: 10, textTransform: 'uppercase', marginBottom: 4 }}>Toplam Geri Ödeme</Text>
                  <Text style={{ color: isDark ? '#fff' : '#000', fontSize: 20, fontWeight: '900' }}>{(parseFloat(amount) * parseInt(months)).toLocaleString('tr-TR')} TL</Text>
                </View>
              </View>
              <View style={{ height: 1, backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)', marginBottom: 8 }} />
              <Text style={{ color: '#71717a', fontSize: 11, fontWeight: '600' }}>
                Toplam Faiz: {((parseFloat(amount) * parseInt(months)) - parseFloat(principal)).toLocaleString('tr-TR')} TL
              </Text>
            </BlurView>
          )}

          <Text style={styles.inputLabel}>{getDynamicDateLabel()}</Text>
          {Platform.OS === 'web' ? (
            <View style={[styles.inputWrapper, { backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : '#ffffff', borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)' }]}>
              <Ionicons name="calendar-outline" size={20} color={isDark ? '#a1a1aa' : '#71717a'} style={styles.inputIcon} />
              <TextInput
                style={[styles.input, { color: isDark ? '#ffffff' : '#000000' }]}
                placeholder="GG.AA.YYYY"
                placeholderTextColor={isDark ? '#71717a' : '#a1a1aa'}
                value={formattedDate}
                onChangeText={setFormattedDate}
                keyboardType="numeric"
              />
            </View>
          ) : (
            <>
              <Pressable
                onPress={() => setShowDatePicker(true)}
                style={[styles.inputWrapper, { backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : '#ffffff', borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)' }]}
              >
                <Ionicons name="calendar-outline" size={20} color={isDark ? '#a1a1aa' : '#71717a'} style={styles.inputIcon} />
                <Text style={[styles.input, { color: isDark ? '#ffffff' : '#000000', lineHeight: 54 }]}>
                  {formattedDate}
                </Text>
              </Pressable>
              {showDatePicker && (
                <DateTimePicker
                  value={date}
                  mode="date"
                  display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                  onChange={onChangeDate}
                  themeVariant={isDark ? "dark" : "light"}
                />
              )}
            </>
          )}


          {/* Kategori */}
          {selectedDocType.categories && (
            <>
              <Text style={styles.sectionTitle}>Kategori</Text>
              <View style={styles.categoryContainer}>
                {selectedDocType.categories.map(cat => {
                  const isActive = selectedCategory === cat;
                  return (
                    <Pressable key={cat} onPress={() => setSelectedCategory(cat)} style={({pressed}) => [{ transform: [{ scale: pressed ? 0.95 : 1 }] }]}>
                      {isActive ? (
                        <LinearGradient
                          colors={selectedDocType.colors}
                          style={[styles.categoryBadgeActive, { shadowColor: selectedDocType.color }]}
                          start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                        >
                          <Text style={styles.categoryTextActive}>{cat}</Text>
                        </LinearGradient>
                      ) : (
                        <BlurView intensity={isDark ? 20 : 40} tint={isDark ? "dark" : "light"} style={styles.categoryBadgeInactiveBlur}>
                          <View style={[styles.categoryBadgeInactiveInner, { borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)' }]}>
                            <Text style={[styles.categoryTextInactive, { color: isDark ? '#a1a1aa' : '#52525b' }]}>{cat}</Text>
                          </View>
                        </BlurView>
                      )}
                    </Pressable>
                  );
                })}
              </View>
            </>
          )}

          {/* Hatırlatma Tercihi (Tüm belge türleri) */}
          <Text style={styles.sectionTitle}>Hatırlatma Tercihi 🔔</Text>
          <Text style={{ color: isDark ? '#71717a' : '#a1a1aa', fontSize: 13, fontWeight: '500', marginBottom: 14, marginTop: -8 }}>
            Son tarihe ne kadar kala hatırlatma bildirimi gönderilsin?
          </Text>
          <View style={styles.categoryContainer}>
            {[
              { id: '1_minute' as ReminderOption, label: 'Şimdi Test Et (1 Dk)' },
              { id: '1_week' as ReminderOption, label: '1 Hafta' },
              { id: '2_weeks' as ReminderOption, label: '2 Hafta' },
              { id: '3_weeks' as ReminderOption, label: '3 Hafta' },
              { id: '1_month' as ReminderOption, label: '1 Ay' },
              { id: '2_months' as ReminderOption, label: '2 Ay' },
              { id: '3_months' as ReminderOption, label: '3 Ay' },
            ].map(opt => {
              const isActive = selectedReminders.includes(opt.id);
              return (
                <Pressable
                  key={opt.id}
                  onPress={() => {
                    setSelectedReminders(prev =>
                      prev.includes(opt.id)
                        ? prev.filter(r => r !== opt.id)
                        : [...prev, opt.id]
                    );
                  }}
                  style={({pressed}) => [{ transform: [{ scale: pressed ? 0.95 : 1 }] }]}
                >
                  {isActive ? (
                    <LinearGradient
                      colors={selectedDocType.colors}
                      style={[styles.categoryBadgeActive, { shadowColor: selectedDocType.color }]}
                      start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                    >
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Ionicons name="checkmark-circle" size={16} color="#fff" />
                        <Text style={styles.categoryTextActive}>{opt.label}</Text>
                      </View>
                    </LinearGradient>
                  ) : (
                    <BlurView intensity={isDark ? 20 : 40} tint={isDark ? "dark" : "light"} style={styles.categoryBadgeInactiveBlur}>
                      <View style={[styles.categoryBadgeInactiveInner, { borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)' }]}>
                        <Text style={[styles.categoryTextInactive, { color: isDark ? '#a1a1aa' : '#52525b' }]}>{opt.label}</Text>
                      </View>
                    </BlurView>
                  )}
                </Pressable>
              );
            })}
          </View>

          {/* Belge Fotoğrafı Ekleme */}
          <Text style={styles.sectionTitle}>Belge Fotoğrafları / Ek Dosyalar</Text>
          
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 32 }}>
            <View style={{ flexDirection: 'row', gap: 12 }}>
              {images.map((imgUri, index) => (
                <View key={index} style={[styles.imageWrapper, { width: 200, marginBottom: 0, borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)' }]}>
                  <Image source={{ uri: imgUri }} style={[styles.image, { height: 250 }]} />
                  {index === 0 && isAnalyzing && (
                    <View style={styles.analyzingOverlay}>
                      <BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFill} />
                      <ActivityIndicator size="large" color="#6366f1" />
                      <Text style={[styles.analyzingText, { fontSize: 12, textAlign: 'center' }]}>Analiz Ediliyor...</Text>
                    </View>
                  )}
                  <Pressable style={styles.editImageBtn} onPress={() => { 
                    setImages(prev => prev.filter((_, i) => i !== index)); 
                    setBase64Images(prev => prev.filter((_, i) => i !== index)); 
                  }}>
                    <Ionicons name="close" size={20} color="#fff" />
                  </Pressable>
                </View>
              ))}
              
              <View style={{ gap: 12, flexDirection: images.length > 0 ? 'column' : 'row' }}>
                <Pressable onPress={pickImage} style={images.length > 0 ? {} : { flex: 1 }}>
                  <BlurView intensity={isDark ? 30 : 60} tint={isDark ? "dark" : "light"} style={[styles.blurButtonContainer, { borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)', width: images.length > 0 ? 120 : undefined, height: images.length > 0 ? 119 : 60 }]}>
                    <LinearGradient colors={isDark ? ['rgba(255,255,255,0.05)', 'rgba(255,255,255,0.01)'] : ['rgba(255,255,255,0.8)', 'rgba(255,255,255,0.4)']} style={[styles.actionButtonSecondary, { height: '100%', flexDirection: images.length > 0 ? 'column' : 'row' }]}>
                      <Ionicons name="images" size={24} color={isDark ? "#ffffff" : selectedDocType.color} style={{ marginRight: images.length > 0 ? 0 : 12, marginBottom: images.length > 0 ? 8 : 0 }} />
                      <Text style={[styles.buttonSubtitleSecondary, { color: isDark ? '#fff' : '#000', fontWeight: '700', textAlign: 'center' }]}>Galeriden Seç</Text>
                    </LinearGradient>
                  </BlurView>
                </Pressable>
                
                <Pressable onPress={takePhoto} style={images.length > 0 ? {} : { flex: 1, marginLeft: images.length === 0 ? 12 : 0 }}>
                  <LinearGradient colors={selectedDocType.colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.actionButton, { width: images.length > 0 ? 120 : undefined, height: images.length > 0 ? 119 : 60, flexDirection: images.length > 0 ? 'column' : 'row' }]}>
                    <Ionicons name="camera" size={24} color="#fff" style={{ marginRight: images.length > 0 ? 0 : 12, marginBottom: images.length > 0 ? 8 : 0 }} />
                    <Text style={{ color: '#fff', fontWeight: '800', fontSize: 14, textAlign: 'center' }}>Kamera</Text>
                  </LinearGradient>
                </Pressable>
              </View>
            </View>
          </ScrollView>

          {/* OCR Result */}
          {result && (
            <BlurView intensity={isDark ? 20 : 50} tint={isDark ? "dark" : "light"} style={styles.resultBoxWrapper}>
              <LinearGradient
                colors={isDark
                  ? ['rgba(99, 102, 241, 0.15)', 'rgba(67, 56, 202, 0.05)']
                  : ['rgba(99, 102, 241, 0.08)', 'rgba(67, 56, 202, 0.02)']}
                style={styles.resultBox}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12, gap: 8 }}>
                  <Ionicons name="sparkles" size={16} color="#6366f1" />
                  <Text style={styles.resultTitle}>Yapay Zeka Analizi</Text>
                </View>
                <Text style={[styles.resultText, { color: isDark ? '#e4e4e7' : '#18181b' }]}>{result}</Text>
              </LinearGradient>
            </BlurView>
          )}
              {isVehicleType && selectedCategory === 'Servis / Bakım' && (
                <Pressable 
                  onPress={() => setShowServicePicker(true)}
                  style={[styles.inputGroup, { backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : '#fff', marginTop: 24 }]}
                >
                  <Ionicons name="construct-outline" size={20} color="#f59e0b" style={styles.inputIcon} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 12, color: '#71717a' }}>Sonraki Bakım Tarihi</Text>
                    <Text style={{ color: isDark ? '#fff' : '#000', fontSize: 16, fontWeight: '600' }}>
                      {nextServiceDate ? nextServiceDate.toLocaleDateString('tr-TR') : 'Tarih Seçilmedi'}
                    </Text>
                  </View>
                  <Ionicons name="calendar-outline" size={20} color={isDark ? '#a1a1aa' : '#71717a'} />
                </Pressable>
              )}

              {showServicePicker && (
                <DateTimePicker
                  value={nextServiceDate || new Date()}
                  mode="date"
                  display="default"
                  onChange={(event, date) => {
                    setShowServicePicker(false);
                    if (date) setNextServiceDate(date);
                  }}
                />
              )}
            </View>

        {/* Save Button */}
        <View style={styles.actionRow}>
          <Pressable style={styles.saveButton} onPress={handleSave} disabled={loading}>
            <LinearGradient
              colors={loading ? (isDark ? ['#3f3f46', '#27272a'] : ['#d4d4d8', '#a1a1aa']) : selectedDocType.colors}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
              style={[styles.saveButtonGradient, loading && styles.saveButtonDisabled]}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  <Ionicons name="checkmark-circle" size={24} color="#fff" style={{ marginRight: 8 }} />
                  <Text style={styles.saveButtonText}>Kaydet</Text>
                </>
              )}
            </LinearGradient>
          </Pressable>
        </View>
        <View style={{ height: 100 }} />
      </ScrollView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, padding: 24, paddingTop: 40, paddingBottom: 100 },
  pageHeader: { marginBottom: 36, alignItems: 'center' },
  iconCircle: { width: 72, height: 72, borderRadius: 36, justifyContent: 'center', alignItems: 'center', marginBottom: 16 },
  pageTitle: { fontSize: 28, fontWeight: '900', marginBottom: 12, letterSpacing: -0.5 },
  pageDescription: { color: '#a1a1aa', fontSize: 16, fontWeight: '500', lineHeight: 24, textAlign: 'center', paddingHorizontal: 20 },
  formContainer: { flex: 1, width: '100%' },
  inputLabel: { color: '#a1a1aa', fontSize: 13, marginBottom: 8, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 1 },
  inputWrapper: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 16, paddingHorizontal: 16, height: 56, marginBottom: 24, width: '100%', maxWidth: '100%', overflow: 'hidden', flexShrink: 1 },
  buttonIcon: { marginRight: 8 },
  inputIcon: { marginRight: 12 },
  input: { flex: 1, fontSize: 16, fontWeight: '500', height: '100%', ...(Platform.OS === 'web' && { outlineStyle: 'none' } as any) },
  buttonContainer: { flexDirection: 'row', width: '100%', marginBottom: 32 },
  blurButtonContainer: { borderRadius: 24, overflow: 'hidden', borderWidth: 1 },
  actionButton: { padding: 18, borderRadius: 24, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.2, shadowRadius: 12, elevation: 8 },
  actionButtonSecondary: { padding: 18, borderRadius: 24, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  buttonSubtitleSecondary: { color: '#a1a1aa', fontSize: 14, fontWeight: '500' },
  imageWrapper: { width: '100%', borderRadius: 32, padding: 6, borderWidth: 1, marginBottom: 32, backgroundColor: 'rgba(0,0,0,0.02)', shadowColor: '#000', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.1, shadowRadius: 20, elevation: 10 },
  image: { width: '100%', height: 320, borderRadius: 26 },
  editImageBtn: { position: 'absolute', top: 16, right: 16, width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center', zIndex: 10 },
  sectionTitle: { color: '#a1a1aa', fontSize: 13, marginBottom: 14, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 1 },
  // Doc type cards (grid)
  docTypeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, justifyContent: 'space-between', marginBottom: 32 },
  docTypeCardActive: { padding: 20, borderRadius: 28, alignItems: 'center', width: '100%', gap: 10, shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.4, shadowRadius: 16, elevation: 12 },
  iconCircleWhite: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#ffffff', justifyContent: 'center', alignItems: 'center', marginBottom: 4 },
  docTypeLabelActive: { fontSize: 14, fontWeight: '900', textAlign: 'center', color: '#ffffff', letterSpacing: -0.3 },
  docTypeDescActive: { fontSize: 11, fontWeight: '600', textAlign: 'center', color: 'rgba(255,255,255,0.8)', lineHeight: 16 },
  docTypeCardInactiveBlur: { borderRadius: 28, overflow: 'hidden', width: '100%' },
  docTypeCardInactiveInner: { padding: 20, borderRadius: 28, alignItems: 'center', width: '100%', gap: 10, borderWidth: 1, backgroundColor: 'rgba(255,255,255,0.02)' },
  iconCircleDark: { width: 48, height: 48, borderRadius: 24, justifyContent: 'center', alignItems: 'center', marginBottom: 4 },
  docTypeLabelInactive: { fontSize: 14, fontWeight: '800', textAlign: 'center', letterSpacing: -0.3 },
  docTypeDescInactive: { fontSize: 11, fontWeight: '500', textAlign: 'center', lineHeight: 16 },
  // Category chips
  categoryContainer: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 36 },
  categoryBadgeActive: { paddingVertical: 14, paddingHorizontal: 20, borderRadius: 20, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 4 },
  categoryTextActive: { fontWeight: '800', fontSize: 14, color: '#ffffff' },
  categoryBadgeInactiveBlur: { borderRadius: 20, overflow: 'hidden' },
  categoryBadgeInactiveInner: { paddingVertical: 14, paddingHorizontal: 20, borderRadius: 20, borderWidth: 1, backgroundColor: 'rgba(255,255,255,0.02)' },
  categoryTextInactive: { fontWeight: '600', fontSize: 14 },
  // Action
  actionRow: { width: '100%', marginTop: 'auto', paddingTop: 20 },
  saveButton: { width: '100%', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.4, shadowRadius: 16, borderRadius: 24, backgroundColor: 'transparent', elevation: 10 },
  saveButtonGradient: { flexDirection: 'row', padding: 22, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  saveButtonDisabled: { opacity: 0.7, shadowOpacity: 0 },
  saveButtonText: { color: '#ffffff', fontSize: 17, fontWeight: '800', letterSpacing: 0.5 },
  // Result box
  resultBoxWrapper: { width: '100%', borderRadius: 24, overflow: 'hidden', marginBottom: 32, borderWidth: 1, borderColor: 'rgba(99, 102, 241, 0.3)' },
  resultBox: { width: '100%', padding: 24 },
  resultTitle: { color: '#6366f1', fontWeight: '900', letterSpacing: 0.5, fontSize: 14, textTransform: 'uppercase' },
  resultText: { fontSize: 15, lineHeight: 26, fontWeight: '500' },
  analyzingOverlay: { ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center', borderRadius: 26, overflow: 'hidden' },
  analyzingText: { color: '#fff', marginTop: 12, fontWeight: '800', fontSize: 16, textShadowColor: 'rgba(0,0,0,0.5)', textShadowRadius: 4, textShadowOffset: { width: 0, height: 1 } },
  inputGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 16,
    height: 56,
    marginBottom: 16,
    width: '100%'
  },
  section: {
    marginBottom: 32,
    width: '100%'
  },
});
