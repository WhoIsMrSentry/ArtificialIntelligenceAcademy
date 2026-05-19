import {
  View, Text, StyleSheet, FlatList, ActivityIndicator,
  RefreshControl, Animated, Pressable, Dimensions, Platform, ScrollView, Modal, Image, TextInput, useWindowDimensions
} from 'react-native';
import Svg, { Path as SvgPath, G } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { useState, useCallback, useRef, useEffect } from 'react';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect, router } from 'expo-router';
import { fetchInvoices, deleteInvoice, updateInvoiceDetails, appendImageToInvoice, parseTurkishNumber, supabase } from '../src/services/api';
import * as ImagePicker from 'expo-image-picker';
import { registerForPushNotificationsAsync, scheduleReminderNotification } from '../src/services/notifications';
import type { ReminderOption } from '../src/services/notifications';
import { BlurView } from 'expo-blur';
import { useTheme } from '../src/context/ThemeContext';
import { useAuth } from '../src/context/AuthContext';
import * as Haptics from 'expo-haptics';
import { Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const { width, height } = Dimensions.get('window');

const getCurrencySymbol = (code: string) => {
  switch (code) {
    case 'USD': return '$';
    case 'EUR': return '€';
    case 'GBP': return '£';
    default: return '₺';
  }
};

type TabType = 'warranty' | 'invoice' | 'vehicle' | 'konut' | 'kontrat' | 'kredi' | 'subscription';

interface TabConfig {
  id: TabType;
  label: string;
  shortLabel: string;
  icon: string;
  color: string;
  colors: [string, string];
}
const TABS: TabConfig[] = [
  { id: 'warranty', label: 'Garanti', shortLabel: 'garanti', icon: 'shield-checkmark', color: '#6366f1', colors: ['#6366f1', '#4338ca'] },
  { id: 'invoice', label: 'Faturalar', shortLabel: 'fatura', icon: 'receipt', color: '#0ea5e9', colors: ['#0ea5e9', '#0284c7'] },
  { id: 'vehicle', label: 'Garajım', shortLabel: 'araç', icon: 'car-sport', color: '#f59e0b', colors: ['#f59e0b', '#d97706'] },
  { id: 'konut', label: 'Konut', shortLabel: 'konut', icon: 'home', color: '#10b981', colors: ['#10b981', '#059669'] },
  { id: 'kontrat', label: 'Kontrat', shortLabel: 'kontrat', icon: 'document-text', color: '#8b5cf6', colors: ['#8b5cf6', '#7c3aed'] },
  { id: 'kredi', label: 'Borçlarım', shortLabel: 'borç', icon: 'wallet', color: '#ef4444', colors: ['#ef4444', '#dc2626'] },
  { id: 'subscription', label: 'Abonelik', shortLabel: 'abonelik', icon: 'repeat', color: '#ec4899', colors: ['#ec4899', '#db2777'] }
];

export default function HomeScreen() {
  const [warranties, setWarranties] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<TabType>('warranty');
  const [planModalVisible, setPlanModalVisible] = useState(false);
  const [currentPlan, setCurrentPlan] = useState<any[] | null>(null);
  const [currentPlanTitle, setCurrentPlanTitle] = useState('');
  const [currentPlanItem, setCurrentPlanItem] = useState<any | null>(null);
  const [detailItem, setDetailItem] = useState<any>(null);
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editingItem, setEditingItem] = useState<any>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editAmount, setEditAmount] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [isImageFull, setIsImageFull] = useState<string | false>(false);
  const [showWelcome, setShowWelcome] = useState(false);
  const [dontShowAgain, setDontShowAgain] = useState(false);
  const [selectedFolder, setSelectedFolder] = useState('Tümü');
  const { isDark, toggleTheme } = useTheme();
  const { user } = useAuth();

  const parseMetadata = (text: string) => {
    const folderMatch = text?.match(/\[FOLDER:(.*?)\]/);
    const serviceMatch = text?.match(/\[SERVICE:(.*?)\]/);
    return {
      folder: folderMatch ? folderMatch[1] : null,
      serviceDate: serviceMatch ? serviceMatch[1] : null
    };
  };

  const firstName = user?.user_metadata?.full_name?.split(' ')[0] || user?.email?.split('@')[0] || 'Kullanıcı';

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(40)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;

  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const numColumns = Platform.OS === 'web' ? (windowWidth > 1100 ? 3 : windowWidth > 700 ? 2 : 1) : 1;

  const startAnimations = () => {
    fadeAnim.setValue(0);
    slideAnim.setValue(40);
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
      Animated.spring(slideAnim, { toValue: 0, friction: 8, tension: 40, useNativeDriver: true })
    ]).start();
  };

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.05, duration: 2000, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 2000, useNativeDriver: true }),
      ])
    ).start();
  }, []);

  useEffect(() => {
    if (!user?.id) return;
    const checkWelcome = async () => {
      try {
        const hasSeen = await AsyncStorage.getItem(`@has_seen_onboarding_${user.id}`);
        if (hasSeen !== 'true') {
          setShowWelcome(true);
        }
      } catch (e) {}
    };
    checkWelcome();
  }, [user?.id]);

  const closeWelcome = async () => {
    if (dontShowAgain && user?.id) {
      try {
        await AsyncStorage.setItem(`@has_seen_onboarding_${user.id}`, 'true');
      } catch (e) {}
    }
    setShowWelcome(false);
  };

  const handleAddAttachment = async (itemId: string, currentImageUrl: string | null) => {
    let res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: false, allowsMultipleSelection: true, quality: 0.8, base64: true });
    if (!res.canceled && res.assets && res.assets.length > 0) {
      setLoading(true);
      try {
        let currentUrl = currentImageUrl;
        for (const asset of res.assets) {
          if (asset.base64) {
             currentUrl = await appendImageToInvoice(itemId, currentUrl, asset.base64);
          }
        }
        
        // Update local state
        const updatedWarranties = warranties.map(w => w.id === itemId ? { ...w, image_url: currentUrl } : w);
        setWarranties(updatedWarranties);
        
        if (detailItem && detailItem.id === itemId) {
          setDetailItem({ ...detailItem, image_url: currentUrl });
        }
        if (editingItem && editingItem.id === itemId) {
          setEditingItem({ ...editingItem, image_url: currentUrl });
        }
        
        Alert.alert('Başarılı', 'Ek dosya(lar) eklendi.');
      } catch (error) {
        console.error(error);
        Alert.alert('Hata', 'Ek dosya yüklenemedi.');
      } finally {
        setLoading(false);
      }
    }
  };

  const loadData = async () => {
    try {
      const data = await fetchInvoices();
      setWarranties(data || []);
      startAnimations();
      // Tüm belgeler için hatırlatma bildirimleri
      if (Platform.OS !== 'web') {
        try {
          const items = (data || []).filter((item: any) => item.raw_text?.includes('Hatırlatma:'));
          if (items.length > 0) {
            await registerForPushNotificationsAsync();
            for (const item of items) {
              if (!item.raw_text) continue;
              const reminderMatch = item.raw_text.match(/Hatırlatma:\s*(.+)/);
              if (!reminderMatch) continue;
              const reminders = reminderMatch[1].split(',') as ReminderOption[];

              // Tarih formatını bul (GG.AA.YYYY)
              const datePatterns = [
                /Son Kullanma Tarihi:\s*(\d{2})\.(\d{2})\.(\d{4})/,
                /Son Ödeme Tarihi:\s*(\d{2})\.(\d{2})\.(\d{4})/,
                /Bitiş Tarihi:\s*(\d{2})\.(\d{2})\.(\d{4})/,
                /Satın Alma Tarihi:\s*(\d{2})\.(\d{2})\.(\d{4})/,
                /Taksit Ödeme Günü:\s*(\d{2})\.(\d{2})\.(\d{4})/,
                /Geri Ödeme Tarihi:\s*(\d{2})\.(\d{2})\.(\d{4})/,
                /Yenileme Tarihi:\s*(\d{2})\.(\d{2})\.(\d{4})/,
              ];
              let targetDate: Date | null = null;
              for (const pattern of datePatterns) {
                const match = item.raw_text.match(pattern);
                if (match) {
                  targetDate = new Date(parseInt(match[3]), parseInt(match[2]) - 1, parseInt(match[1]));
                  break;
                }
              }
              if (targetDate && targetDate > new Date()) {
                const tabCfg = TABS.find(t => t.id === item.type) || TABS[0];
                await scheduleReminderNotification(item.filename, targetDate, reminders, tabCfg.label);
              }
            }
          }
        } catch (e) { }
      }
    } catch (error) {
      console.error("Veri çekilemedi:", error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useFocusEffect(useCallback(() => { setLoading(true); loadData(); }, []));

  const onRefresh = () => { setRefreshing(true); loadData(); };

  const handleDelete = async (id: string) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);

    const performDelete = async () => {
      try {
        await deleteInvoice(id);
        setWarranties(prev => prev.filter(item => item.id !== id));
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } catch (error) {
        if (Platform.OS === 'web') {
          window.alert('Silme işlemi başarısız oldu.');
        } else {
          Alert.alert('Hata', 'Silme işlemi başarısız oldu.');
        }
      }
    };

    if (Platform.OS === 'web') {
      if (window.confirm('Bu belgeyi arşivden kalıcı olarak silmek istediğinize emin misiniz?')) {
        await performDelete();
      }
    } else {
      Alert.alert(
        'Belgeyi Sil',
        'Bu belgeyi arşivden kalıcı olarak silmek istediğinize emin misiniz?',
        [
          { text: 'Vazgeç', style: 'cancel' },
          { text: 'Sil', style: 'destructive', onPress: performDelete }
        ]
      );
    }
  };

  const handleSaveEdit = async () => {
    if (!editingItem) return;
    try {
      await updateInvoiceDetails(editingItem.id, {
        filename: editTitle,
        amount: parseTurkishNumber(editAmount),
      });
      setWarranties(prev => prev.map(item =>
        item.id === editingItem.id
          ? { ...item, filename: editTitle, amount: parseTurkishNumber(editAmount) }
          : item
      ));
      setEditModalVisible(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      Alert.alert('Hata', 'Güncelleme yapılamadı.');
    }
  };

  const filteredData = warranties.filter(w => {
    const matchesTab = w.type === activeTab;
    const matchesSearch = w.filename.toLowerCase().includes(searchQuery.toLowerCase());
    const metadata = parseMetadata(w.raw_text);
    const matchesFolder = selectedFolder === 'Tümü' || metadata.folder === selectedFolder;
    return matchesTab && matchesSearch && matchesFolder;
  });

  const availableFolders = ['Tümü', ...Array.from(new Set(warranties
    .filter(w => w.type === activeTab)
    .map(w => parseMetadata(w.raw_text).folder)
    .filter(Boolean)
  )) as string[]];

  const activeTabConfig = TABS.find(t => t.id === activeTab) || TABS[0];

  // Yaklaşanları hesapla (kullanıcının seçtiği hatırlatma süresine göre)
  const upcomingItems = warranties.map(w => {
    const rawText = w.raw_text || '';
    const datePatterns = [
      /Son Kullanma Tarihi:\s*(\d{2})\.(\d{2})\.(\d{4})/,
      /Son Ödeme Tarihi:\s*(\d{2})\.(\d{2})\.(\d{4})/,
      /Bitiş Tarihi:\s*(\d{2})\.(\d{2})\.(\d{4})/,
      /Satın Alma Tarihi:\s*(\d{2})\.(\d{2})\.(\d{4})/,
      /Taksit Ödeme Günü:\s*(\d{2})\.(\d{2})\.(\d{4})/,
      /Geri Ödeme Tarihi:\s*(\d{2})\.(\d{2})\.(\d{4})/,
      /Yenileme Tarihi:\s*(\d{2})\.(\d{2})\.(\d{4})/,
    ];
    let targetDate = null;
    if (w.due_date) {
      targetDate = new Date(w.due_date);
    } else {
      for (const pattern of datePatterns) {
        const match = rawText.match(pattern);
        if (match) {
          targetDate = new Date(parseInt(match[3]), parseInt(match[2]) - 1, parseInt(match[1]));
          break;
        }
      }
    }
    if (!targetDate) return null;

    const reminderMatch = rawText.match(/Hatırlatma:\s*(.+)/);
    if (!reminderMatch) return null; // Hatırlatma yoksa widget'ta gösterme

    const reminders = reminderMatch[1].split(',');
    let maxDaysBefore = 0;
    const daysMap: Record<string, number> = {
      '1_minute': 1,
      '1_week': 7,
      '2_weeks': 14,
      '3_weeks': 21,
      '1_month': 30,
      '2_months': 60,
      '3_months': 90,
    };
    for (const r of reminders) {
      if (daysMap[r] && daysMap[r] > maxDaysBefore) {
        maxDaysBefore = daysMap[r];
      }
    }

    const diffDays = Math.ceil((targetDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));

    if (diffDays >= 0 && diffDays <= maxDaysBefore) {
      return { item: w, diffDays };
    }
    return null;
  }).filter((x): x is { item: any, diffDays: number } => x !== null).sort((a, b) => a.diffDays - b.diffDays);

  const [upcomingModalVisible, setUpcomingModalVisible] = useState(false);

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case 'Elektronik / Bilişim': return 'hardware-chip-outline';
      case 'Beyaz Eşya': return 'snow-outline';
      case 'Küçük Ev Aletleri': return 'cafe-outline';
      case 'Mobilya / Dekorasyon': return 'bed-outline';
      case 'Giyim / Aksesuar': return 'shirt-outline';
      case 'Oto Aksesuar / Parça': return 'construct-outline';
      case 'Spor / Outdoor': return 'bicycle-outline';
      case 'Elektrik': return 'flash-outline';
      case 'Su': return 'water-outline';
      case 'Doğalgaz': return 'flame-outline';
      case 'İnternet / İletişim': return 'wifi-outline';
      case 'Market / Mutfak': return 'cart-outline';
      case 'Sağlık / Eczane': return 'medkit-outline';
      case 'Eğitim / Kurs': return 'school-outline';
      case 'Seyahat / Konaklama': return 'airplane-outline';
      case 'Eğlence / Etkinlik': return 'ticket-outline';
      
      // Legacy Categories
      case 'Elektronik': return 'hardware-chip-outline';
      case 'Ev Aletleri': return 'home-outline';
      case 'Giyim': return 'shirt-outline';
      case 'Faturalar': return 'receipt-outline';
      case 'MTV': return 'car-sport-outline';
      case 'Konut Vergisi': return 'home-outline';
      case 'Ev Sahibi Kontratı': return 'key-outline';
      case 'Kiracı Kontratı': return 'person-outline';
      case 'Kredi': return 'card-outline';
      default: return 'cube-outline';
    }
  };

  const formatDate = (dateString: string) => {
    if (!dateString) return '-';
    const date = new Date(dateString);
    return `${date.getDate().toString().padStart(2, '0')}.${(date.getMonth() + 1).toString().padStart(2, '0')}.${date.getFullYear()}`;
  };

  const generatePaymentPlan = (rawText: string) => {
    if (!rawText) return null;
    const tutarMatch = rawText.match(/Tutar:\s*([\d.,]+)/);
    const vadeMatch = rawText.match(/Vade:\s*(\d+)/);
    const tarihMatch = rawText.match(/Tarih:\s*([\d.]+)|Günü:\s*([\d.]+)/);

    if (!tutarMatch || !vadeMatch || !tarihMatch) return null;

    const tutar = tutarMatch[1];
    const vade = parseInt(vadeMatch[1], 10);
    const tarihStr = tarihMatch[1] || tarihMatch[2];

    const [day, month, year] = tarihStr.split('.').map(Number);
    let plan = [];
    let currentDate = new Date(year, month - 1, day);

    for (let i = 0; i < vade; i++) {
      const fDate = `${currentDate.getDate().toString().padStart(2, '0')}.${(currentDate.getMonth() + 1).toString().padStart(2, '0')}.${currentDate.getFullYear()}`;
      plan.push({ id: i.toString(), date: fDate, amount: tutar, status: 'Ödenmedi' });
      currentDate.setMonth(currentDate.getMonth() + 1);
    }
    return plan;
  };

  const getSubtitle = (item: any) => {
    if (item.type === 'mtv') return 'Motorlu Taşıt Vergisi';
    if (item.type === 'konut') return 'Konut Vergisi';
    if (item.type === 'kontrat') return item.category || 'Kontrat';
    if (item.type === 'kredi') return 'Borç Kaydı';
    return item.category || 'Diğer';
  };

  const renderItem = ({ item }: { item: any }) => {
    const tabCfg = TABS.find(t => t.id === (item.type || 'warranty')) || TABS[0];

    return (
      <Animated.View style={[{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }, numColumns > 1 && { flex: 1, maxWidth: `${100 / numColumns}%`, paddingHorizontal: 6 }]}>
        <Pressable
          onPress={() => setDetailItem(item)}
          style={({ pressed }) => [
            styles.cardContainer,
            {
              backgroundColor: isDark ? '#1a1a2e' : '#ffffff',
              borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.04)',
              transform: [{ scale: pressed ? 0.98 : 1 }],
              elevation: 4,
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 4 },
              shadowOpacity: 0.05,
              shadowRadius: 8,
            }
          ]}
        >
          <View style={[styles.cardIndicator, { backgroundColor: tabCfg.color }]} />

          <View style={styles.cardContent}>
            <View style={[styles.iconContainer, { backgroundColor: tabCfg.color + '1a' }]}>
              <Ionicons name={getCategoryIcon(item.category) as any} size={24} color={tabCfg.color} />
            </View>

            <View style={styles.cardTextContainer}>
              <Text style={[styles.productName, { color: isDark ? '#ffffff' : '#09090b' }]} numberOfLines={1}>{item.filename}</Text>
              
              {/* Metadata Badges (Folder & Service) */}
              <View style={styles.badgeRow}>
                {parseMetadata(item.raw_text).folder && (
                  <View style={[styles.miniBadge, { backgroundColor: isDark ? 'rgba(99, 102, 241, 0.1)' : 'rgba(99, 102, 241, 0.05)' }]}>
                    <Ionicons name="folder" size={10} color="#6366f1" />
                    <Text style={[styles.miniBadgeText, { color: '#6366f1' }]}>{parseMetadata(item.raw_text).folder}</Text>
                  </View>
                )}
                {parseMetadata(item.raw_text).serviceDate && (
                  <View style={[styles.miniBadge, { backgroundColor: isDark ? 'rgba(245, 158, 11, 0.1)' : 'rgba(245, 158, 11, 0.05)' }]}>
                    <Ionicons name="construct" size={10} color="#f59e0b" />
                    <Text style={[styles.miniBadgeText, { color: '#f59e0b' }]}>Bakım: {new Date(parseMetadata(item.raw_text).serviceDate!).toLocaleDateString('tr-TR')}</Text>
                  </View>
                )}
              </View>

              <View style={styles.badgeRow}>
                <Text style={[styles.categoryBadgeText, { color: tabCfg.color }]}>{getSubtitle(item)}</Text>
                <View style={styles.dot} />
                <Text style={[styles.dateValue, { color: isDark ? '#71717a' : '#a1a1aa' }]}>{formatDate(item.created_at)}</Text>
              </View>
              {item.amount > 0 && (
                <Text style={[styles.amountText, { color: tabCfg.color }]}>
                  {item.amount.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} {getCurrencySymbol(item.currency)}
                </Text>
              )}

              {/* Card Image with Overlay */}
              {item.image_url && (
                <View style={{ marginTop: 12, width: '100%', height: 120, borderRadius: 12, overflow: 'hidden', backgroundColor: isDark ? 'rgba(0,0,0,0.2)' : 'rgba(0,0,0,0.05)' }}>
                  <Image
                    source={{ uri: item.image_url.split(',')[0] }}
                    style={{ width: '100%', height: '100%' }}
                    resizeMode="cover"
                  />
                  <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}>
                    {(() => {
                      const annotationsMatch = item.raw_text?.match(/\[MARKUP_DATA\]([\s\S]*)$/);
                      if (annotationsMatch) {
                        try {
                          const paths = JSON.parse(annotationsMatch[1]);
                          return (
                            <Svg width="100%" height="100%" pointerEvents="none" viewBox={`0 0 ${windowWidth} ${windowHeight}`}>
                              <G>
                                {paths.map((path: any, index: number) => (
                                  <SvgPath
                                    key={index}
                                    d={`M ${path.points.map((p: any) => `${p.x} ${p.y}`).join(' L ')}`}
                                    stroke={path.color}
                                    strokeWidth={path.width}
                                    strokeOpacity={path.opacity}
                                    fill="none"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  />
                                ))}
                              </G>
                            </Svg>
                          );
                        } catch (e) { return null; }
                      }
                      return null;
                    })()}
                  </View>
                </View>
              )}

              {item.type === 'kredi' && item.raw_text?.includes('Vade:') && (
                <Pressable
                  onPress={() => {
                    const plan = generatePaymentPlan(item.raw_text);
                    if (plan) {
                      setCurrentPlan(plan);
                      setCurrentPlanTitle(item.filename);
                      setCurrentPlanItem(item);
                      setPlanModalVisible(true);
                    } else {
                      Alert.alert('Hata', 'Ödeme planı oluşturulamadı. Veri eksik.');
                    }
                  }}
                  style={{ marginTop: 8, alignSelf: 'flex-start', backgroundColor: tabCfg.color + '22', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 }}
                >
                  <Text style={{ color: tabCfg.color, fontSize: 11, fontWeight: '700' }}>Ödeme Planını Gör</Text>
                </Pressable>
              )}
            </View>

            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Pressable
                style={({ pressed }) => [styles.actionBtn, { opacity: pressed ? 0.5 : 1 }]}
                onPress={() => {
                  setEditingItem(item);
                  setEditTitle(item.filename);

                  // Eğer veritabanında tutar yoksa metinden çekmeye çalış
                  let initialAmount = item.amount?.toString() || '';
                  if (!initialAmount || initialAmount === '0') {
                    const amountMatch = item.raw_text?.match(/Tutar:\s*([\d.,]+)/);
                    if (amountMatch) initialAmount = amountMatch[1].replace(',', '.');
                  }

                  setEditAmount(initialAmount);
                  setEditModalVisible(true);
                }}
                hitSlop={15}
              >
                <View style={[styles.actionIconBg, { backgroundColor: isDark ? 'rgba(99,102,241,0.1)' : 'rgba(99,102,241,0.08)' }]}>
                  <Ionicons name="create-outline" size={18} color="#6366f1" />
                </View>
              </Pressable>

              <Pressable
                style={({ pressed }) => [styles.actionBtn, { opacity: pressed ? 0.5 : 1 }]}
                onPress={() => handleDelete(item.id)}
                hitSlop={15}
              >
                <View style={[styles.actionIconBg, { backgroundColor: isDark ? 'rgba(239,68,68,0.1)' : 'rgba(239,68,68,0.08)' }]}>
                  <Ionicons name="trash" size={18} color="#ef4444" />
                </View>
              </Pressable>
            </View>
          </View>
        </Pressable>
      </Animated.View>
    );
  };

  const renderSkeleton = () => (
    <View style={[numColumns > 1 && { flex: 1, maxWidth: `${100 / numColumns}%`, paddingHorizontal: 6 }]}>
      <View style={[styles.cardContainer, { backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : '#ffffff', borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.04)' }]}>
        <View style={[styles.cardIndicator, { backgroundColor: isDark ? '#3f3f46' : '#e2e8f0' }]} />
        <View style={styles.cardContent}>
          <View style={[styles.iconContainer, { backgroundColor: isDark ? '#27272a' : '#f1f5f9' }]} />
          <View style={styles.cardTextContainer}>
            <View style={[styles.skeletonLine, { width: '60%', backgroundColor: isDark ? '#27272a' : '#f1f5f9' }]} />
            <View style={[styles.skeletonLine, { width: '40%', height: 10, marginTop: 8, backgroundColor: isDark ? '#18181b' : '#f8fafc' }]} />
          </View>
        </View>
      </View>
    </View>
  );

  return (
    <LinearGradient colors={isDark ? ['#050505', '#0a0a1a'] : ['#f8fafc', '#f1f5f9']} style={styles.container}>
      <Animated.View style={[styles.ambientLight, { transform: [{ scale: pulseAnim }], backgroundColor: activeTabConfig.color + '26' }]} />

      <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}>
        <View style={styles.pageHeader}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, paddingRight: 4 }}>
              <View style={{
                width: 50,
                height: 50,
                borderRadius: 25,
                backgroundColor: '#ffffff',
                justifyContent: 'center',
                alignItems: 'center',
                shadowColor: '#6366f1',
                shadowOffset: { width: 0, height: 6 },
                shadowOpacity: 0.15,
                shadowRadius: 12,
                elevation: 6,
                borderWidth: 1,
                borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)',
                overflow: 'hidden'
              }}>
                <Image 
                  source={require('../assets/images/logo-transparent.png')} 
                  style={{ width: '100%', height: '100%' }} 
                  resizeMode="cover"
                />
              </View>
              <View style={{ flex: 1, flexShrink: 1 }}>
                <Text 
                  style={[styles.pageTitle, { color: isDark ? '#ffffff' : '#09090b', fontSize: 20 }]} 
                  numberOfLines={1} 
                  adjustsFontSizeToFit={true} 
                  minimumFontScale={0.8}
                >
                  Hoş geldin, {firstName} 👋
                </Text>
                <Text style={[styles.pageDescription, { fontWeight: '700', color: '#6366f1' }]} numberOfLines={1}>Dijital Arşiv</Text>
              </View>
            </View>
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
              <Pressable onPress={toggleTheme} hitSlop={10}>
                <View style={{
                  width: 44, height: 44, borderRadius: 14,
                  backgroundColor: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(99,102,241,0.12)',
                  justifyContent: 'center', alignItems: 'center',
                  borderWidth: 1,
                  borderColor: isDark ? 'rgba(255,255,255,0.15)' : 'rgba(99,102,241,0.2)',
                }}>
                  <Ionicons name={isDark ? 'sunny' : 'moon'} size={22} color={isDark ? '#f4f4f5' : '#6366f1'} />
                </View>
              </Pressable>
              
              <Pressable onPress={() => router.push('/profil')} hitSlop={10}>
                <View style={{
                  width: 44, height: 44, borderRadius: 14,
                  backgroundColor: isDark ? 'rgba(99,102,241,0.12)' : 'rgba(99,102,241,0.12)',
                  justifyContent: 'center', alignItems: 'center',
                  borderWidth: 1,
                  borderColor: isDark ? 'rgba(99,102,241,0.15)' : 'rgba(99,102,241,0.2)',
                }}>
                  <Ionicons name="person-circle-outline" size={26} color={isDark ? '#a5b4fc' : '#6366f1'} />
                </View>
              </Pressable>
            </View>
          </View>
        </View>
      </Animated.View>

      <View style={styles.tabWrapper}>
        {/* Arama Çubuğu */}
        <BlurView intensity={isDark ? 20 : 40} tint={isDark ? "dark" : "light"} style={styles.searchWrapper}>
          <Ionicons name="search" size={20} color={isDark ? '#71717a' : '#a1a1aa'} style={{ marginRight: 12 }} />
          <TextInput
            style={[styles.searchInput, { color: isDark ? '#fff' : '#000' }]}
            placeholder="İsim veya kategori ara..."
            placeholderTextColor={isDark ? '#52525b' : '#a1a1aa'}
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
          {searchQuery.length > 0 && (
            <Pressable onPress={() => setSearchQuery('')}>
              <Ionicons name="close-circle" size={18} color={isDark ? '#71717a' : '#a1a1aa'} />
            </Pressable>
          )}
        </BlurView>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabGridContent}>
          {TABS.map(tab => {
            const isActive = activeTab === tab.id;
            return (
              <Pressable key={tab.id} onPress={() => { setActiveTab(tab.id); setSelectedFolder('Tümü'); }} style={({ pressed }) => [styles.tabPill, { transform: [{ scale: pressed ? 0.95 : 1 }] }]}>
                {isActive ? (
                  <LinearGradient
                    colors={tab.colors}
                    style={[styles.tabGradientActive, { shadowColor: tab.color, elevation: 6 }]}
                    start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                  >
                    <Ionicons name={tab.icon as any} size={16} color="#fff" />
                    <Text style={styles.tabTextActive}>{tab.label}</Text>
                  </LinearGradient>
                ) : (
                  <BlurView intensity={isDark ? 20 : 40} tint={isDark ? "dark" : "light"} style={styles.tabInactiveBlur}>
                    <View style={[styles.tabGradientInactive, { borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)' }]}>
                      <Ionicons name={tab.icon as any} size={16} color={isDark ? '#71717a' : '#a1a1aa'} />
                      <Text style={[styles.tabTextInactive, { color: isDark ? '#71717a' : '#a1a1aa' }]}>{tab.label}</Text>
                    </View>
                  </BlurView>
                )}
              </Pressable>
            );
          })}
        </ScrollView>

        {/* Folder Filter Chips */}
        {availableFolders.length > 1 && (
          <View style={{ marginTop: 12 }}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 4, gap: 8 }}>
              {availableFolders.map((folder) => (
                <Pressable
                  key={folder}
                  onPress={() => setSelectedFolder(folder)}
                  style={[
                    styles.folderChip,
                    { 
                      backgroundColor: selectedFolder === folder ? '#6366f1' : (isDark ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.6)'),
                      borderColor: selectedFolder === folder ? '#6366f1' : (isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)')
                    }
                  ]}
                >
                  <Ionicons 
                    name={folder === 'Tümü' ? 'grid-outline' : 'folder-outline'} 
                    size={14} 
                    color={selectedFolder === folder ? '#fff' : (isDark ? '#a1a1aa' : '#71717a')} 
                  />
                  <Text style={[styles.folderChipText, { color: selectedFolder === folder ? '#fff' : (isDark ? '#a1a1aa' : '#71717a') }]}>
                    {folder}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        )}
      </View>

      {/* Count badge */}
      <View style={styles.countRow}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={[styles.countText, { color: isDark ? '#71717a' : '#a1a1aa' }]}>
            {filteredData.length} kayıt bulundu
          </Text>
          <View style={[styles.countDot, { backgroundColor: activeTabConfig.color }]} />
        </View>
      </View>

      <FlatList
        key={`grid-${numColumns}`}
        data={loading && !refreshing ? [1, 2, 3, 4, 5, 6] : filteredData}
        numColumns={numColumns}
        columnWrapperStyle={numColumns > 1 ? { paddingHorizontal: 18, justifyContent: 'flex-start' } : undefined}
        keyExtractor={(item, index) => loading ? `skeleton-${index}` : item.id}
        renderItem={loading && !refreshing ? renderSkeleton : renderItem}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={activeTabConfig.color} />}
        ListHeaderComponent={() => {
          if (loading) return null;

          const renderSubscriptionCalendar = () => {
            if (activeTab !== 'subscription') return null;

            const daysInMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
            const currentDay = new Date().getDate();
            const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);

            return (
              <View style={{ marginBottom: 24 }}>
                <Text style={[styles.sectionTitle, { color: isDark ? '#fff' : '#000', marginLeft: 0 }]}>Ödeme Takvimi</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingVertical: 10 }}>
                  {days.map(day => {
                    const hasPayment = warranties.some(w => {
                      if (w.type !== 'subscription') return false;
                      const d = w.due_date ? new Date(w.due_date) : null;
                      if (d) return d.getDate() === day;
                      const match = w.raw_text?.match(/Yenileme Tarihi:\s*(\d{2})\.(\d{2})\.(\d{4})/);
                      return match && parseInt(match[1]) === day;
                    });

                    return (
                      <View key={day} style={{ alignItems: 'center', gap: 6 }}>
                        <View style={[
                          { width: 45, height: 65, borderRadius: 16, justifyContent: 'center', alignItems: 'center', borderWidth: 1 },
                          day === currentDay
                            ? { backgroundColor: '#ec4899', borderColor: '#ec4899' }
                            : { backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : '#fff', borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)' }
                        ]}>
                          <Text style={{ fontSize: 12, fontWeight: '700', color: day === currentDay ? '#fff' : '#71717a' }}>
                            {['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'][new Date(new Date().getFullYear(), new Date().getMonth(), day).getDay()]}
                          </Text>
                          <Text style={{ fontSize: 18, fontWeight: '900', color: day === currentDay ? '#fff' : (isDark ? '#fff' : '#000') }}>
                            {day}
                          </Text>
                        </View>
                        {hasPayment && <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: '#ec4899' }} />}
                      </View>
                    );
                  })}
                </ScrollView>
              </View>
            );
          };

          return (
            <View>
              {renderSubscriptionCalendar()}
              {upcomingItems.length > 0 && (
                <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }], marginBottom: 20 }}>
                  <Pressable onPress={() => setUpcomingModalVisible(true)} style={({ pressed }) => [{ transform: [{ scale: pressed ? 0.98 : 1 }] }]}>
                    <LinearGradient
                      colors={isDark ? ['#3f2c00', '#1a1200'] : ['#fef3c7', '#fef08a']}
                      start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                      style={{
                        padding: 20,
                        borderRadius: 24,
                        borderWidth: 1,
                        borderColor: isDark ? '#b45309' : '#fde047',
                        flexDirection: 'row',
                        alignItems: 'center',
                        shadowColor: '#d97706',
                        shadowOffset: { width: 0, height: 8 },
                        shadowOpacity: 0.15,
                        shadowRadius: 16,
                        elevation: 5,
                        backgroundColor: isDark ? '#1a1200' : '#fef3c7'
                      }}
                    >
                      <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: 'rgba(217, 119, 6, 0.2)', justifyContent: 'center', alignItems: 'center', marginRight: 16 }}>
                        <Ionicons name="warning" size={24} color="#d97706" />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 16, fontWeight: '900', color: isDark ? '#fcd34d' : '#92400e', marginBottom: 4 }}>
                          Yaklaşan {upcomingItems.length} Ödeme / Bitiş
                        </Text>
                        <Text style={{ fontSize: 13, color: isDark ? '#fbbf24' : '#b45309', fontWeight: '600' }}>
                          Zamanı yaklaşan {upcomingItems.length} belgeniz var. Detayları görmek için dokunun.
                        </Text>
                      </View>
                      <Ionicons name="chevron-forward" size={20} color={isDark ? '#fcd34d' : '#92400e'} />
                    </LinearGradient>
                  </Pressable>
                </Animated.View>
              )}
            </View>
          );
        }}
        ListEmptyComponent={
          <Animated.View style={[styles.emptyState, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
            <View style={styles.emptyIconContainer}>
              <View style={[styles.emptyIconBg, { backgroundColor: activeTabConfig.color, opacity: 0.15 }]} />
              <Ionicons name={activeTabConfig.icon as any} size={72} color={activeTabConfig.color} style={styles.emptyIcon} />
            </View>
            <Text style={[styles.emptyTitle, { color: isDark ? '#ffffff' : '#09090b' }]}>
              {activeTabConfig.label} Boş
            </Text>
            <Text style={styles.emptyText}>
              Henüz bir {activeTabConfig.shortLabel} kaydı bulunmuyor.
            </Text>
          </Animated.View>
        }
      />

      {/* Floating Action Button (FAB) */}
      <Pressable
        style={({ pressed }) => [styles.fab, { transform: [{ scale: pressed ? 0.95 : 1 }], elevation: 12 }]}
        onPress={() => router.push(`/add?type=${activeTab}`)}
      >
        <LinearGradient colors={activeTabConfig.colors} style={styles.fabGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}>
          <Ionicons name="add" size={30} color="#fff" />
        </LinearGradient>
      </Pressable>

      {/* Plan Modal */}
      <Modal visible={planModalVisible} animationType="slide" transparent={true}>
        <BlurView intensity={isDark ? 50 : 80} tint={isDark ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
        <View style={styles.modalContainer}>
          <View style={[styles.modalContent, { backgroundColor: isDark ? '#18181b' : '#ffffff', borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)' }]}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={[styles.modalTitle, { color: isDark ? '#fff' : '#000' }]}>Ödeme Planı</Text>
                <Text style={styles.modalSubtitle}>{currentPlanTitle}</Text>
              </View>
              <Pressable onPress={() => setPlanModalVisible(false)} style={styles.modalCloseBtn}>
                <Ionicons name="close" size={24} color={isDark ? '#a1a1aa' : '#52525b'} />
              </Pressable>
            </View>
            <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
              {/* Kredi Özeti (Ödeme Planı Üstü) */}
              {currentPlanItem?.type === 'kredi' && currentPlanItem?.raw_text && (
                <View style={{ backgroundColor: isDark ? 'rgba(99, 102, 241, 0.15)' : 'rgba(99, 102, 241, 0.08)', padding: 20, borderRadius: 24, marginBottom: 24, borderWidth: 1, borderColor: '#6366f144' }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16 }}>
                    <View>
                      <Text style={{ color: '#6366f1', fontWeight: '900', fontSize: 10, textTransform: 'uppercase' }}>Anapara</Text>
                      <Text style={{ color: isDark ? '#fff' : '#000', fontSize: 18, fontWeight: '900' }}>{currentPlanItem.raw_text.match(/Anapara:\s*([\d.,]+)\s*TL/)?.[1] || '---'} TL</Text>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={{ color: '#10b981', fontWeight: '900', fontSize: 10, textTransform: 'uppercase' }}>Toplam Geri Ödeme</Text>
                      <Text style={{ color: isDark ? '#fff' : '#000', fontSize: 18, fontWeight: '900' }}>{currentPlanItem.raw_text.match(/Toplam Geri Ödeme:\s*([\d.,]+)\s*TL/)?.[1] || '---'} TL</Text>
                    </View>
                  </View>
                  <View style={{ height: 1, backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)', marginBottom: 12 }} />
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={{ color: isDark ? '#a1a1aa' : '#71717a', fontSize: 12, fontWeight: '600' }}>Vade: {currentPlanItem.raw_text.match(/Vade:\s*(\d+)\s*Ay/)?.[1] || '--'} Ay</Text>
                    <Text style={{ color: isDark ? '#a1a1aa' : '#71717a', fontSize: 12, fontWeight: '600' }}>Faiz: %{currentPlanItem.raw_text.match(/Faiz Oranı:\s*%?([\d.,]+)/)?.[1] || '0,00'}</Text>
                  </View>
                </View>
              )}

              {currentPlan?.map((p, index) => (
                <View key={p.id} style={[styles.planRow, { borderBottomColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)' }]}>
                  <View style={styles.planDateCol}>
                    <Text style={[styles.planMonth, { color: isDark ? '#fff' : '#000' }]}>{index + 1}. Taksit</Text>
                    <Text style={styles.planDateText}>{p.date}</Text>
                  </View>
                  <View style={styles.planAmountCol}>
                    <Text style={[styles.planAmount, { color: isDark ? '#fff' : '#000' }]}>{p.amount} TL</Text>
                    <View style={styles.planStatusBadge}>
                      <Text style={styles.planStatusText}>{p.status}</Text>
                    </View>
                  </View>
                </View>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Edit Modal */}
      <Modal visible={editModalVisible} animationType="fade" transparent={true}>
        <BlurView intensity={isDark ? 60 : 80} tint={isDark ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
        <View style={styles.modalContainer}>
          <View style={[styles.modalContent, { height: 'auto', paddingBottom: 60, borderTopLeftRadius: 32, borderTopRightRadius: 32, backgroundColor: isDark ? '#18181b' : '#ffffff' }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: isDark ? '#fff' : '#000' }]}>Belgeyi Düzenle</Text>
              <Pressable onPress={() => setEditModalVisible(false)} style={styles.modalCloseBtn}>
                <Ionicons name="close" size={24} color={isDark ? '#a1a1aa' : '#52525b'} />
              </Pressable>
            </View>

            <ScrollView style={{ maxHeight: 500 }} showsVerticalScrollIndicator={false}>
              <View style={{ gap: 20 }}>
                {editingItem?.image_url && (
                  <View style={{ marginBottom: 10 }}>
                    <Text style={[styles.detailLabel, { marginBottom: 8 }]}>Belge Görselleri</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -24, paddingHorizontal: 24 }}>
                      <View style={{ flexDirection: 'row', gap: 12, paddingRight: 48 }}>
                        {editingItem.image_url.split(',').filter((url: string) => url).map((url: string, index: number) => (
                          <Image
                            key={index}
                            source={{ uri: url }}
                            style={{ width: 280, height: 200, borderRadius: 16 }}
                            resizeMode="cover"
                          />
                        ))}
                      </View>
                    </ScrollView>
                  </View>
                )}

                <View>
                  <Text style={[styles.detailLabel, { marginBottom: 8 }]}>Belge Adı</Text>
                  <TextInput
                    style={[styles.editInput, { color: isDark ? '#fff' : '#000', backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)' }]}
                    value={editTitle}
                    onChangeText={setEditTitle}
                    placeholder="Belge Adı"
                    placeholderTextColor="#71717a"
                  />
                </View>

                <View>
                  <Text style={[styles.detailLabel, { marginBottom: 8 }]}>Tutar (TL)</Text>
                  <TextInput
                    style={[styles.editInput, { color: isDark ? '#fff' : '#000', backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)' }]}
                    value={editAmount}
                    onChangeText={setEditAmount}
                    keyboardType="numeric"
                    placeholder="0.00"
                    placeholderTextColor="#71717a"
                  />
                </View>

                <Pressable
                  onPress={handleSaveEdit}
                  style={({ pressed }) => [
                    styles.saveEditBtn,
                    { backgroundColor: activeTabConfig.color, transform: [{ scale: pressed ? 0.98 : 1 }] }
                  ]}
                >
                  <Text style={styles.saveEditBtnText}>Değişiklikleri Kaydet</Text>
                </Pressable>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Detail Modal */}
      <Modal visible={!!detailItem} animationType="slide" transparent={true}>
        <BlurView intensity={isDark ? 50 : 80} tint={isDark ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
        <View style={styles.modalContainer}>
          <View style={[styles.modalContent, { backgroundColor: isDark ? '#18181b' : '#ffffff', borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)' }]}>
            <View style={styles.modalHeader}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.modalTitle, { color: isDark ? '#fff' : '#000' }]}>{detailItem?.filename}</Text>
                <Text style={styles.modalSubtitle}>{getSubtitle(detailItem || {})}</Text>
              </View>
              <Pressable onPress={() => setDetailItem(null)} style={styles.modalCloseBtn}>
                <Ionicons name="close" size={24} color={isDark ? '#a1a1aa' : '#52525b'} />
              </Pressable>
            </View>
            <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
              {/* Info rows */}
              <View style={{ gap: 16 }}>
                <View style={[styles.detailRow, { borderBottomColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)' }]}>
                  <View style={styles.detailIconCol}>
                    <Ionicons name="cash-outline" size={20} color="#6366f1" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.detailLabel}>Tutar</Text>
                    <Text style={[styles.detailValue, { color: isDark ? '#fff' : '#000' }]}>
                      {detailItem?.amount?.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} {getCurrencySymbol(detailItem?.currency)}
                    </Text>
                  </View>
                </View>
                <View style={[styles.detailRow, { borderBottomColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)' }]}>
                  <View style={styles.detailIconCol}>
                    <Ionicons name="folder-outline" size={20} color={isDark ? '#a1a1aa' : '#71717a'} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.detailLabel]}>Kategori</Text>
                    <Text style={[styles.detailValue, { color: isDark ? '#fff' : '#000' }]}>{detailItem?.category || 'Belirtilmemiş'}</Text>
                  </View>
                </View>
                <View style={[styles.detailRow, { borderBottomColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)' }]}>
                  <View style={styles.detailIconCol}>
                    <Ionicons name="calendar-outline" size={20} color={isDark ? '#a1a1aa' : '#71717a'} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.detailLabel}>Oluşturulma Tarihi</Text>
                    <Text style={[styles.detailValue, { color: isDark ? '#fff' : '#000' }]}>{formatDate(detailItem?.created_at)}</Text>
                  </View>
                </View>

                {/* Kredi Detayları (Varsa) */}
                {detailItem?.type === 'kredi' && detailItem?.raw_text?.includes('Anapara:') && (
                  <View style={{ backgroundColor: isDark ? 'rgba(99, 102, 241, 0.1)' : 'rgba(99, 102, 241, 0.05)', padding: 16, borderRadius: 20, marginVertical: 8 }}>
                    <Text style={{ color: '#6366f1', fontWeight: '900', fontSize: 11, textTransform: 'uppercase', marginBottom: 12 }}>Kredi Özeti</Text>
                    <View style={{ gap: 12 }}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                        <Text style={{ color: isDark ? '#a1a1aa' : '#71717a', fontSize: 13, fontWeight: '600' }}>Anapara</Text>
                        <Text style={{ color: isDark ? '#fff' : '#000', fontWeight: '800' }}>{detailItem.raw_text.match(/Anapara:\s*([\d.,]+)\s*TL/)?.[1] || '---'} TL</Text>
                      </View>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                        <Text style={{ color: isDark ? '#a1a1aa' : '#71717a', fontSize: 13, fontWeight: '600' }}>Aylık Taksit</Text>
                        <Text style={{ color: '#6366f1', fontWeight: '800' }}>{detailItem.raw_text.match(/Aylık Taksit:\s*([\d.,]+)\s*TL/)?.[1] || '---'} TL</Text>
                      </View>
                      <View style={{ height: 1, backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)' }} />
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                        <Text style={{ color: isDark ? '#a1a1aa' : '#71717a', fontSize: 13, fontWeight: '700' }}>Toplam Geri Ödeme</Text>
                        <Text style={{ color: '#10b981', fontWeight: '900', fontSize: 16 }}>{detailItem.raw_text.match(/Toplam Geri Ödeme:\s*([\d.,]+)\s*TL/)?.[1] || '---'} TL</Text>
                      </View>
                    </View>
                  </View>
                )}
                {detailItem?.raw_text && (
                  <View style={{ marginTop: 8 }}>
                    <Text style={[styles.detailLabel, { marginBottom: 8 }]}>Belge Detayları (Yapay Zeka Analizi)</Text>
                    <View style={[styles.detailTextBox, { backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)', borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)' }]}>
                      <Text style={[styles.detailRawText, { color: isDark ? '#d4d4d8' : '#3f3f46' }]}>
                        {detailItem.raw_text?.replace(/\[MARKUP_DATA\][\s\S]*$/, '').trim()}
                      </Text>
                    </View>
                  </View>
                )}

                {/* Orijinal Fotoğraf Gösterimi */}
                {detailItem?.image_url && (
                  <View style={{ marginTop: 24 }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <Text style={[styles.detailLabel, { marginBottom: 0 }]}>Orijinal Belge Görselleri / Ekler</Text>
                      <Pressable onPress={() => handleAddAttachment(detailItem.id, detailItem.image_url)} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                        <Ionicons name="add-circle" size={18} color="#6366f1" />
                        <Text style={{ color: '#6366f1', fontSize: 13, fontWeight: '700' }}>Ek Dosya Ekle</Text>
                      </Pressable>
                    </View>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -24, paddingHorizontal: 24 }}>
                      <View style={{ flexDirection: 'row', gap: 12, paddingRight: 48 }}>
                        {detailItem?.image_url?.split(',').filter((url: string) => url).map((url: string, index: number) => (
                          <Pressable
                            key={index}
                            onPress={() => setIsImageFull(url)}
                            style={({ pressed }) => [{ opacity: pressed ? 0.9 : 1, width: 280 }]}
                          >
                            <View style={[styles.detailTextBox, { padding: 4, overflow: 'hidden', backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)', borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)' }]}>
                              <View style={{ width: '100%', height: 400, position: 'relative' }}>
                                <Image
                                  source={{ uri: url }}
                                  style={{ width: '100%', height: '100%', borderRadius: 12 }}
                                  resizeMode="cover"
                                />
                                <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}>
                                  {(() => {
                                    const annotationsMatch = detailItem?.raw_text?.match(/\[MARKUP_DATA\]([\s\S]*)$/);
                                    if (annotationsMatch) {
                                      try {
                                        const paths = JSON.parse(annotationsMatch[1]);
                                        return (
                                          <Svg width="100%" height="100%" pointerEvents="none" viewBox={`0 0 ${windowWidth} ${windowHeight}`}>
                                            <G>
                                              {paths.map((path: any, index: number) => (
                                                <SvgPath
                                                  key={index}
                                                  d={`M ${path.points.map((p: any) => `${p.x} ${p.y}`).join(' L ')}`}
                                                  stroke={path.color}
                                                  strokeWidth={path.width}
                                                  strokeOpacity={path.opacity}
                                                  fill="none"
                                                  strokeLinecap="round"
                                                  strokeLinejoin="round"
                                                />
                                              ))}
                                            </G>
                                          </Svg>
                                        );
                                      } catch (e) { return null; }
                                    }
                                    return null;
                                  })()}
                                </View>
                              </View>
                              <View style={{ position: 'absolute', bottom: 12, right: 12, backgroundColor: 'rgba(0,0,0,0.5)', padding: 8, borderRadius: 20 }}>
                                <Ionicons name="expand-outline" size={20} color="#fff" />
                              </View>
                            </View>
                          </Pressable>
                        ))}
                      </View>
                    </ScrollView>
                  </View>
                )}

                {/* Takvime Ekle Butonu */}
                <Pressable
                  style={({ pressed }) => [
                    {
                      marginTop: 24,
                      paddingVertical: 14,
                      paddingHorizontal: 20,
                      borderRadius: 16,
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: isDark ? 'rgba(99,102,241,0.15)' : 'rgba(99,102,241,0.1)',
                      borderWidth: 1,
                      borderColor: isDark ? 'rgba(99,102,241,0.3)' : 'rgba(99,102,241,0.2)',
                      transform: [{ scale: pressed ? 0.96 : 1 }]
                    }
                  ]}
                  onPress={() => {
                    const title = encodeURIComponent(`${detailItem?.filename || 'Belge'} - Hatırlatma`);
                    const details = encodeURIComponent(`Dijital Arşiv: ${getSubtitle(detailItem || {})}`);

                    let targetDate = new Date();
                    const rawText = detailItem?.raw_text || '';
                    const datePatterns = [
                      /Son Kullanma Tarihi:\s*(\d{2})\.(\d{2})\.(\d{4})/,
                      /Son Ödeme Tarihi:\s*(\d{2})\.(\d{2})\.(\d{4})/,
                      /Bitiş Tarihi:\s*(\d{2})\.(\d{2})\.(\d{4})/,
                      /Satın Alma Tarihi:\s*(\d{2})\.(\d{2})\.(\d{4})/,
                      /Taksit Ödeme Günü:\s*(\d{2})\.(\d{2})\.(\d{4})/,
                      /Geri Ödeme Tarihi:\s*(\d{2})\.(\d{2})\.(\d{4})/,
                      /Tarih:\s*(\d{2})\.(\d{2})\.(\d{4})/,
                      /Günü:\s*(\d{2})\.(\d{2})\.(\d{4})/,
                    ];
                    for (const pattern of datePatterns) {
                      const match = rawText.match(pattern);
                      if (match) {
                        targetDate = new Date(parseInt(match[3]), parseInt(match[2]) - 1, parseInt(match[1]));
                        break;
                      }
                    }

                    const formatGDate = (d: Date) => d.toISOString().replace(/-|:|\.\d\d\d/g, "").split('T')[0];
                    const dateStr = formatGDate(targetDate);
                    const nextDayStr = formatGDate(new Date(targetDate.getTime() + 24 * 60 * 60 * 1000));

                    const gCalUrl = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&details=${details}&dates=${dateStr}/${nextDayStr}`;

                    import('react-native').then(({ Linking }) => {
                      Linking.openURL(gCalUrl).catch(() => {
                        Alert.alert('Hata', 'Takvim açılamadı.');
                      });
                    });
                  }}
                >
                  <Ionicons name="calendar" size={20} color="#6366f1" style={{ marginRight: 8 }} />
                  <Text style={{ color: '#6366f1', fontSize: 16, fontWeight: '800' }}>Google Takvime Ekle</Text>
                </Pressable>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Upcoming Items Modal */}
      <Modal
        visible={upcomingModalVisible}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setUpcomingModalVisible(false)}
      >
        <View style={{ flex: 1, justifyContent: 'flex-end' }}>
          <BlurView intensity={isDark ? 40 : 20} tint={isDark ? "dark" : "light"} style={StyleSheet.absoluteFill} />
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setUpcomingModalVisible(false)} />
          <View style={{
            backgroundColor: isDark ? '#18181b' : '#ffffff',
            borderTopLeftRadius: 32,
            borderTopRightRadius: 32,
            maxHeight: '85%',
            minHeight: '40%',
            shadowColor: '#000',
            shadowOffset: { width: 0, height: -10 },
            shadowOpacity: 0.15,
            shadowRadius: 20,
            elevation: 20,
            borderWidth: 1,
            borderColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'
          }}>
            <View style={{ alignItems: 'center', paddingTop: 12, paddingBottom: 8 }}>
              <View style={{ width: 40, height: 5, borderRadius: 3, backgroundColor: isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.2)' }} />
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 24, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(217, 119, 6, 0.2)', justifyContent: 'center', alignItems: 'center' }}>
                  <Ionicons name="warning" size={20} color="#d97706" />
                </View>
                <Text style={{ fontSize: 20, fontWeight: '900', color: isDark ? '#ffffff' : '#18181b', letterSpacing: -0.5 }}>Yaklaşan Belgeler</Text>
              </View>
              <Pressable onPress={() => setUpcomingModalVisible(false)} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)', justifyContent: 'center', alignItems: 'center' }}>
                <Ionicons name="close" size={20} color={isDark ? '#a1a1aa' : '#71717a'} />
              </Pressable>
            </View>

            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 24, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
              {upcomingItems.map(({ item, diffDays }) => {
                const isUrgent = diffDays <= 3;
                const tabConfig = TABS.find(t => t.id === item.type) || TABS[0];

                return (
                  <Pressable
                    key={item.id}
                    onPress={() => {
                      setUpcomingModalVisible(false);
                      setDetailItem(item);
                    }}
                    style={({ pressed }) => [
                      {
                        borderRadius: 24,
                        marginBottom: 16,
                        overflow: 'hidden',
                        transform: [{ scale: pressed ? 0.98 : 1 }]
                      }
                    ]}
                  >
                    <LinearGradient
                      colors={isUrgent ? (isDark ? ['#3f1d1d', '#200f0f'] : ['#fee2e2', '#fecaca']) : (isDark ? ['rgba(255,255,255,0.06)', 'rgba(255,255,255,0.02)'] : ['#ffffff', '#f8fafc'])}
                      start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                      style={{
                        padding: 20,
                        borderWidth: 1,
                        borderColor: isUrgent ? (isDark ? '#7f1d1d' : '#fca5a5') : (isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)'),
                        borderRadius: 24,
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 16
                      }}
                    >
                      <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: tabConfig.color + '20', justifyContent: 'center', alignItems: 'center' }}>
                        <Ionicons name={tabConfig.icon as any} size={20} color={tabConfig.color} />
                      </View>

                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 17, fontWeight: '800', color: isDark ? '#ffffff' : '#18181b', marginBottom: 4 }} numberOfLines={1}>
                          {item.filename}
                        </Text>
                        <Text style={{ fontSize: 13, color: isDark ? '#a1a1aa' : '#71717a', fontWeight: '500' }}>
                          Kategori: {item.category}
                        </Text>
                      </View>

                      <View style={{ alignItems: 'flex-end', justifyContent: 'center' }}>
                        <Text style={{ fontSize: 22, fontWeight: '900', color: isUrgent ? '#ef4444' : (isDark ? '#f4f4f5' : '#3f3f46') }}>
                          {diffDays === 0 ? 'Bugün' : `${diffDays}`}
                        </Text>
                        <Text style={{ fontSize: 12, color: isUrgent ? '#ef4444' : (isDark ? '#a1a1aa' : '#71717a'), fontWeight: '700', marginTop: -2 }}>
                          {diffDays === 0 ? 'Son Gün' : 'Gün Kaldı'}
                        </Text>
                      </View>
                    </LinearGradient>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>
      {/* Full Screen Image Modal */}
      <Modal visible={!!isImageFull} transparent={true} animationType="fade">
        <View style={{ flex: 1, backgroundColor: 'black', justifyContent: 'center', alignItems: 'center' }}>
          <Pressable
            style={{ position: 'absolute', top: 50, right: 24, zIndex: 10, width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.2)', justifyContent: 'center', alignItems: 'center' }}
            onPress={() => setIsImageFull(false)}
          >
            <Ionicons name="close" size={28} color="#fff" />
          </Pressable>
          <Pressable
            style={{ position: 'absolute', top: 50, left: 24, zIndex: 10, flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 16, borderRadius: 20, backgroundColor: 'rgba(99,102,241,0.9)', gap: 8 }}
            onPress={() => {
              const currentImageUrl = typeof isImageFull === 'string' ? isImageFull : detailItem?.image_url?.split(',')[0];
              const annotationsMatch = detailItem?.raw_text?.match(/\[MARKUP_DATA\]([\s\S]*)$/);
              const annotations = annotationsMatch ? annotationsMatch[1] : '';
              
              setIsImageFull(false);
              router.push({
                pathname: '/annotate',
                params: {
                  imageUrl: currentImageUrl,
                  invoiceId: detailItem?.id,
                  existingAnnotations: annotations
                }
              });
            }}
          >
            <Ionicons name="create" size={20} color="#fff" />
            <Text style={{ color: '#fff', fontWeight: '800' }}>İşaretle</Text>
          </Pressable>

          <View style={{ width: windowWidth, height: '100%', justifyContent: 'center', alignItems: 'center' }}>
            <Image
              source={{ uri: typeof isImageFull === 'string' ? isImageFull : detailItem?.image_url?.split(',')[0] }}
              style={{ width: '100%', height: '100%' }}
              resizeMode="contain"
            />
            <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}>
              {(() => {
                const annotationsMatch = detailItem?.raw_text?.match(/\[MARKUP_DATA\]([\s\S]*)$/);
                if (annotationsMatch) {
                  try {
                    const paths = JSON.parse(annotationsMatch[1]);
                    return (
                      <Svg width="100%" height="100%" pointerEvents="none">
                        <G>
                          {paths.map((path: any, index: number) => (
                            <SvgPath
                              key={index}
                              d={`M ${path.points.map((p: any) => `${p.x} ${p.y}`).join(' L ')}`}
                              stroke={path.color}
                              strokeWidth={path.width}
                              strokeOpacity={path.opacity}
                              fill="none"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          ))}
                        </G>
                      </Svg>
                    );
                  } catch (e) { return null; }
                }
                return null;
              })()}
            </View>
          </View>
        </View>
      </Modal>

      {/* Onboarding / Welcome Modal */}
      <Modal visible={showWelcome} transparent={true} animationType="slide">
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: 24 }}>
          <View style={{ backgroundColor: isDark ? '#18181b' : '#ffffff', borderRadius: 28, padding: 32, alignItems: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.3, shadowRadius: 20, elevation: 15, maxWidth: 500, alignSelf: 'center', width: '100%' }}>
            
            <View style={{ width: 80, height: 80, borderRadius: 40, backgroundColor: isDark ? 'rgba(99, 102, 241, 0.2)' : 'rgba(99, 102, 241, 0.1)', justifyContent: 'center', alignItems: 'center', marginBottom: 24 }}>
              <Ionicons name="sparkles" size={40} color="#6366f1" />
            </View>

            <Text style={{ fontSize: 26, fontWeight: '900', color: isDark ? '#ffffff' : '#09090b', marginBottom: 12, textAlign: 'center' }}>
              Dijital Arşiv'e{'\n'}Hoş Geldiniz
            </Text>
            
            <Text style={{ fontSize: 15, color: isDark ? '#a1a1aa' : '#71717a', textAlign: 'center', marginBottom: 32, lineHeight: 22 }}>
              Dijital arşivinizi oluşturmak hiç bu kadar kolay olmamıştı. İşte yapabilecekleriniz:
            </Text>

            <View style={{ width: '100%', gap: 20, marginBottom: 32 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
                <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(16, 185, 129, 0.1)', justifyContent: 'center', alignItems: 'center' }}>
                  <Ionicons name="camera" size={20} color="#10b981" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 16, fontWeight: '700', color: isDark ? '#ffffff' : '#18181b' }}>Yapay Zeka ile Tarama</Text>
                  <Text style={{ fontSize: 13, color: isDark ? '#a1a1aa' : '#71717a', marginTop: 4 }}>Fiş ve faturalarınızı okutun, verileri yapay zeka doldursun.</Text>
                </View>
              </View>

              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
                <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(239, 68, 68, 0.1)', justifyContent: 'center', alignItems: 'center' }}>
                  <Ionicons name="notifications" size={20} color="#ef4444" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 16, fontWeight: '700', color: isDark ? '#ffffff' : '#18181b' }}>Akıllı Hatırlatıcılar</Text>
                  <Text style={{ fontSize: 13, color: isDark ? '#a1a1aa' : '#71717a', marginTop: 4 }}>Garanti veya ödeme süreleri yaklaşınca bildirim alın.</Text>
                </View>
              </View>

              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
                <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(99, 102, 241, 0.1)', justifyContent: 'center', alignItems: 'center' }}>
                  <Ionicons name="pie-chart" size={20} color="#6366f1" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 16, fontWeight: '700', color: isDark ? '#ffffff' : '#18181b' }}>Gelişmiş İstatistik</Text>
                  <Text style={{ fontSize: 13, color: isDark ? '#a1a1aa' : '#71717a', marginTop: 4 }}>Harcamalarınızı çevirerek grafiksel olarak analiz edin.</Text>
                </View>
              </View>
            </View>

            <Pressable 
              onPress={() => setDontShowAgain(!dontShowAgain)}
              style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 24, alignSelf: 'flex-start' }}
            >
              <View style={{ width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: dontShowAgain ? '#6366f1' : (isDark ? '#52525b' : '#d4d4d8'), backgroundColor: dontShowAgain ? '#6366f1' : 'transparent', justifyContent: 'center', alignItems: 'center', marginRight: 12 }}>
                {dontShowAgain && <Ionicons name="checkmark" size={16} color="#fff" />}
              </View>
              <Text style={{ color: isDark ? '#a1a1aa' : '#71717a', fontSize: 14 }}>Bir daha gösterme</Text>
            </Pressable>

            <Pressable onPress={closeWelcome} style={{ width: '100%', borderRadius: 16, overflow: 'hidden' }}>
              <LinearGradient colors={['#6366f1', '#4338ca']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ paddingVertical: 18, alignItems: 'center' }}>
                <Text style={{ color: '#ffffff', fontSize: 16, fontWeight: 'bold' }}>Keşfetmeye Başla</Text>
              </LinearGradient>
            </Pressable>
            
          </View>
        </View>
      </Modal>

    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  ambientLight: { position: 'absolute', top: -100, right: -100, width: 300, height: 300, borderRadius: 150, opacity: 0.5 },
  pageHeader: { paddingHorizontal: 24, paddingTop: Platform.OS === 'ios' ? 60 : 50, paddingBottom: 20, zIndex: 10 },
  pageTitle: { fontSize: 42, fontWeight: '900', marginBottom: 6, letterSpacing: -1.5, textAlign: 'left' },
  pageDescription: { color: '#a1a1aa', fontSize: 15, fontWeight: '500', lineHeight: 22, textAlign: 'left' },
  tabWrapper: { paddingHorizontal: 24, zIndex: 10, marginBottom: 16 },
  searchWrapper: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, height: 50, borderRadius: 15, marginBottom: 16, borderWidth: 1, borderColor: 'rgba(99,102,241,0.1)' },
  searchInput: { flex: 1, fontSize: 15, fontWeight: '600', ...(Platform.OS === 'web' && { outlineStyle: 'none' } as any) },
  tabGridContent: { flexDirection: 'row', gap: 10, paddingRight: 20 },
  tabPill: { borderRadius: 24, overflow: 'hidden' },
  tabGradientActive: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 20, borderRadius: 24, gap: 8, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.4, shadowRadius: 12, elevation: 8 },
  tabTextActive: { fontSize: 15, fontWeight: '800', color: '#fff', letterSpacing: 0.3 },
  tabInactiveBlur: { borderRadius: 24, overflow: 'hidden' },
  tabGradientInactive: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 20, borderRadius: 24, gap: 8, borderWidth: 1, backgroundColor: 'rgba(255,255,255,0.02)' },
  tabTextInactive: { fontSize: 15, fontWeight: '600', letterSpacing: 0.3 },
  countRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', paddingHorizontal: 24, marginBottom: 8 },
  countText: { fontSize: 13, fontWeight: '600' },
  countDot: { width: 6, height: 6, borderRadius: 3 },
  list: { padding: 20, paddingTop: 6, paddingBottom: 120 },
  cardContainer: {
    marginBottom: 14,
    borderRadius: 20,
    borderWidth: 1,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.05,
    shadowRadius: 12,
    elevation: 3,
    flexDirection: 'row',
  },
  cardIndicator: { width: 4, height: '100%' },
  cardContent: { flex: 1, flexDirection: 'row', alignItems: 'center', padding: 16, gap: 14 },
  iconContainer: { width: 52, height: 52, borderRadius: 26, justifyContent: 'center', alignItems: 'center' },
  cardTextContainer: { flex: 1, justifyContent: 'center' },
  productName: { fontSize: 16, fontWeight: '800', letterSpacing: -0.3, marginBottom: 4 },
  // badgeRow removed here to fix duplicate error
  categoryBadgeText: { fontSize: 13, fontWeight: '700', letterSpacing: 0.2 },
  amountText: { fontSize: 14, fontWeight: '800', marginTop: 4 },
  dot: { width: 4, height: 4, borderRadius: 2, backgroundColor: '#a1a1aa', marginHorizontal: 8 },
  dateValue: { fontSize: 12, fontWeight: '600' },
  deleteBtn: { justifyContent: 'center', alignItems: 'center' },
  deleteIconBg: { width: 36, height: 36, borderRadius: 18, justifyContent: 'center', alignItems: 'center' },
  actionBtn: { justifyContent: 'center', alignItems: 'center' },
  actionIconBg: { width: 36, height: 36, borderRadius: 18, justifyContent: 'center', alignItems: 'center' },
  editInput: { padding: 16, borderRadius: 16, fontSize: 16, fontWeight: '600', ...(Platform.OS === 'web' && { outlineStyle: 'none' } as any) },
  saveEditBtn: { padding: 18, borderRadius: 16, alignItems: 'center', marginTop: 10 },
  saveEditBtnText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  emptyState: { alignItems: 'center', justifyContent: 'center', marginTop: 60 },
  emptyIconContainer: { position: 'relative', width: 160, height: 160, justifyContent: 'center', alignItems: 'center', marginBottom: 24 },
  emptyIconBg: { position: 'absolute', width: 160, height: 160, borderRadius: 80 },
  emptyIcon: { zIndex: 1 },
  emptyTitle: { fontSize: 24, fontWeight: '900', marginBottom: 12, letterSpacing: -0.5 },
  emptyText: { color: '#71717a', textAlign: 'center', fontSize: 16, fontWeight: '500', lineHeight: 24, marginBottom: 12 },
  fab: { position: 'absolute', bottom: 100, right: 24, shadowColor: '#000', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.3, shadowRadius: 16, borderRadius: 32, backgroundColor: 'transparent' },
  fabGradient: { width: 64, height: 64, borderRadius: 32, justifyContent: 'center', alignItems: 'center' },
  modalContainer: { flex: 1, justifyContent: 'flex-end' },
  modalContent: { height: '80%', borderTopLeftRadius: 32, borderTopRightRadius: 32, borderWidth: 1, padding: 24, paddingBottom: 40 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 },
  modalTitle: { fontSize: 24, fontWeight: '900', letterSpacing: -0.5, marginBottom: 4 },
  modalSubtitle: { fontSize: 14, color: '#71717a', fontWeight: '600' },
  modalCloseBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(113,113,122,0.1)', justifyContent: 'center', alignItems: 'center' },
  planRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 16, borderBottomWidth: 1 },
  planDateCol: { flex: 1 },
  planMonth: { fontSize: 15, fontWeight: '800', marginBottom: 4 },
  planDateText: { fontSize: 13, color: '#a1a1aa', fontWeight: '600' },
  skeletonLine: { height: 16, borderRadius: 8 },
  planAmountCol: { alignItems: 'flex-end' },
  planAmount: { fontSize: 16, fontWeight: '900', letterSpacing: -0.3, marginBottom: 6 },
  planStatusBadge: { backgroundColor: 'rgba(239, 68, 68, 0.1)', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  planStatusText: { color: '#ef4444', fontSize: 10, fontWeight: '800', textTransform: 'uppercase' },
  detailRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingBottom: 16, borderBottomWidth: 1 },
  detailIconCol: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(113,113,122,0.1)', justifyContent: 'center', alignItems: 'center' },
  detailLabel: { fontSize: 12, fontWeight: '700', color: '#a1a1aa', textTransform: 'uppercase', letterSpacing: 0.5 },
  detailValue: { fontSize: 16, fontWeight: '800', marginTop: 2 },
  detailTextBox: { padding: 16, borderRadius: 16, borderWidth: 1 },
  detailRawText: { fontSize: 14, fontWeight: '500', lineHeight: 22 },
  sectionTitle: { fontSize: 18, fontWeight: '800', marginBottom: 16, marginTop: 8 },
  folderChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
    gap: 6
  },
  folderChipText: {
    fontSize: 13,
    fontWeight: '700',
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 8,
    marginBottom: 4
  },
  miniBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    gap: 4
  },
  miniBadgeText: {
    fontSize: 10,
    fontWeight: '800',
  },
});
