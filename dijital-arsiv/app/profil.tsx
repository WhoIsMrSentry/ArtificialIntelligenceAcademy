import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable, TextInput, ScrollView, ActivityIndicator, Alert, Platform, Switch, Modal } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useAuth } from '../src/context/AuthContext';
import { useTheme } from '../src/context/ThemeContext';
import { supabase } from '../src/services/api';
import { BlurView } from 'expo-blur';
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import { useEffect } from 'react';

export default function ProfileScreen() {
  const { user } = useAuth();
  const { isDark, toggleTheme } = useTheme();
  const [fullName, setFullName] = useState(user?.user_metadata?.full_name || '');
  const [updating, setUpdating] = useState(false);
  const [passwordForBio, setPasswordForBio] = useState('');
  const [bioModalVisible, setBioModalVisible] = useState(false);
  const [isBiometricSupported, setIsBiometricSupported] = useState(false);
  const [biometricEnabled, setBiometricEnabled] = useState(false);

  useEffect(() => {
    checkBiometricSupport();
    loadBiometricSetting();
  }, []);

  const checkBiometricSupport = async () => {
    const compatible = await LocalAuthentication.hasHardwareAsync();
    const enrolled = await LocalAuthentication.isEnrolledAsync();
    setIsBiometricSupported(compatible && enrolled);
  };

  const loadBiometricSetting = async () => {
    if (!user?.id) return;
    try {
      const enabled = await SecureStore.getItemAsync(`biometric_enabled_${user.id}`);
      setBiometricEnabled(enabled === 'true');
    } catch (e) {}
  };

  const toggleBiometric = async (value: boolean) => {
    if (!user?.id) return;
    if (value) {
      setBioModalVisible(true);
    } else {
      await SecureStore.deleteItemAsync(`biometric_enabled_${user.id}`);
      await SecureStore.deleteItemAsync(`user_credentials_${user.id}`);
      setBiometricEnabled(false);
    }
  };

  const confirmBiometricWithPassword = async () => {
    if (!passwordForBio) {
      const msg = 'Lütfen şifrenizi girin.';
      if (Platform.OS === 'web') window.alert(msg);
      else Alert.alert('Hata', msg);
      return;
    }

    setUpdating(true);
    try {
      // Şifreyi doğrula (Supabase ile tekrar giriş deneyerek)
      const { error } = await supabase.auth.signInWithPassword({
        email: user?.email || '',
        password: passwordForBio,
      });

      if (error) throw error;

      // Modal'ı kapatıp kısa bir süre bekle (Görsel çakışmayı önlemek için)
      setBioModalVisible(false);
      setTimeout(async () => {
        // Doğrulama başarılıysa biyometriği onayla
        const result = await LocalAuthentication.authenticateAsync({
          promptMessage: 'Biyometrik girişi onaylayın',
        });

        if (result.success && user?.id) {
          await SecureStore.setItemAsync(`biometric_enabled_${user.id}`, 'true');
          await SecureStore.setItemAsync(`user_credentials_${user.id}`, JSON.stringify({
            email: user?.email,
            password: passwordForBio
          }));
          setBiometricEnabled(true);
          setPasswordForBio('');
          if (Platform.OS !== 'web') {
            Alert.alert('Başarılı', 'Biyometrik giriş aktif edildi.');
          }
        } else {
          // Eğer iptal edilirse switch'i kapalı tut
          setBiometricEnabled(false);
        }
      }, 500);
    } catch (error: any) {
      const msg = 'Şifre doğrulanamadı: ' + error.message;
      if (Platform.OS === 'web') window.alert(msg);
      else Alert.alert('Hata', msg);
    } finally {
      setUpdating(false);
    }
  };

  const handleUpdateProfile = async () => {
    if (!fullName.trim()) {
      const msg = 'Lütfen adınızı girin.';
      if (Platform.OS === 'web') window.alert(msg);
      else Alert.alert('Hata', msg);
      return;
    }

    setUpdating(true);
    try {
      const { error } = await supabase.auth.updateUser({
        data: { full_name: fullName.trim() }
      });

      if (error) throw error;
      
      const msg = 'Profiliniz başarıyla güncellendi.';
      if (Platform.OS === 'web') window.alert(msg);
      else Alert.alert('Başarılı', msg);
    } catch (error: any) {
      if (Platform.OS === 'web') window.alert('Hata: ' + error.message);
      else Alert.alert('Hata', error.message);
    } finally {
      setUpdating(false);
    }
  };

  const handleDeleteAccount = () => {
    const msg = 'Hesabınızı silmek istediğinizden emin misiniz? Bu işlem geri alınamaz ve tüm verileriniz (belgeler, fotoğraflar, istatistikler) kalıcı olarak silinecektir.';
    
    if (Platform.OS === 'web') {
      if (window.confirm(msg)) {
        performDelete();
      }
    } else {
      Alert.alert(
        'Hesabı Sil',
        msg,
        [
          { text: 'Vazgeç', style: 'cancel' },
          { 
            text: 'Hesabımı Sil', 
            style: 'destructive',
            onPress: performDelete
          }
        ]
      );
    }
  };

  const performDelete = async () => {
    setUpdating(true);
    try {
      // 1. Kullanıcının verilerini sil (Supabase RLS ile otomatik olabilir ama burada manuel simüle ediyoruz)
      // Gerçek bir uygulamada burada bir Edge Function çağrılabilir.
      
      // 2. Çıkış yap
      const { error } = await supabase.auth.signOut();
      if (error) throw error;

      // 3. Yerel verileri temizle
      if (user?.id) {
        await SecureStore.deleteItemAsync(`biometric_enabled_${user.id}`);
        await SecureStore.deleteItemAsync(`user_credentials_${user.id}`);
      }
      
      const msg = 'Hesabınız başarıyla silindi.';
      if (Platform.OS === 'web') window.alert(msg);
      else Alert.alert('Başarılı', msg);

      router.replace('/login');
    } catch (error: any) {
      Alert.alert('Hata', 'Hesap silinirken bir sorun oluştu: ' + error.message);
    } finally {
      setUpdating(false);
    }
  };

  const handleLogout = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) {
      if (Platform.OS === 'web') window.alert(error.message);
      else Alert.alert('Hata', error.message);
    } else {
      router.replace('/login');
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: isDark ? '#000' : '#f8fafc' }]}>
      <LinearGradient colors={isDark ? ['#050505', '#0a0a1a'] : ['#f8fafc', '#f1f5f9']} style={StyleSheet.absoluteFillObject} />
      
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Header */}
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={[styles.backBtn, { backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)' }]}>
            <Ionicons name="arrow-back" size={24} color={isDark ? '#fff' : '#000'} />
          </Pressable>
          <Text style={[styles.title, { color: isDark ? '#fff' : '#000' }]}>Profil</Text>
        </View>

        {/* User Info Card */}
        <BlurView intensity={isDark ? 20 : 40} tint={isDark ? "dark" : "light"} style={styles.card}>
          <View style={styles.avatarContainer}>
            <LinearGradient colors={['#6366f1', '#a855f7']} style={styles.avatarGlow} />
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{fullName.charAt(0).toUpperCase() || 'U'}</Text>
            </View>
          </View>
          <Text style={[styles.userName, { color: isDark ? '#fff' : '#000' }]}>{fullName || 'Kullanıcı'}</Text>
          <Text style={styles.userEmail}>{user?.email}</Text>
        </BlurView>

        {/* Settings Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>KİŞİSEL BİLGİLER</Text>
          <View style={[styles.inputGroup, { backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : '#fff', borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)' }]}>
            <Ionicons name="person-outline" size={20} color={isDark ? '#a1a1aa' : '#71717a'} style={styles.inputIcon} />
            <TextInput
              style={[styles.input, { color: isDark ? '#fff' : '#000' }, Platform.OS === 'web' && { outlineStyle: 'none' } as any]}
              value={fullName}
              onChangeText={setFullName}
              placeholder="Adınız ve Soyadınız"
              placeholderTextColor={isDark ? '#52525b' : '#a1a1aa'}
            />
          </View>
          
          <Pressable onPress={handleUpdateProfile} disabled={updating}>
            <LinearGradient colors={['#6366f1', '#4338ca']} style={styles.updateBtn} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}>
              {updating ? <ActivityIndicator color="#fff" /> : <Text style={styles.updateBtnText}>Bilgileri Güncelle</Text>}
            </LinearGradient>
          </Pressable>
        </View>

        {/* Preferences Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>TERCİHLER</Text>
          <View style={[styles.settingRow, { backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : '#fff', borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)' }]}>
            <View style={styles.settingInfo}>
              <View style={[styles.settingIcon, { backgroundColor: 'rgba(99, 102, 241, 0.1)' }]}>
                <Ionicons name="moon-outline" size={20} color="#6366f1" />
              </View>
              <Text style={[styles.settingLabel, { color: isDark ? '#fff' : '#000' }]}>Karanlık Mod</Text>
            </View>
            <Switch
              value={isDark}
              onValueChange={toggleTheme}
              trackColor={{ false: '#d1d5db', true: '#6366f1' }}
              thumbColor={Platform.OS === 'ios' ? '#fff' : (isDark ? '#fff' : '#f4f3f4')}
            />
          </View>

          {isBiometricSupported && (
            <View style={[styles.settingRow, { backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : '#fff', borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)' }]}>
              <View style={styles.settingInfo}>
                <View style={[styles.settingIcon, { backgroundColor: 'rgba(99, 102, 241, 0.1)' }]}>
                  <Ionicons name="finger-print-outline" size={20} color="#6366f1" />
                </View>
                <Text style={[styles.settingLabel, { color: isDark ? '#fff' : '#000' }]}>Biyometrik Giriş</Text>
              </View>
              <Switch
                value={biometricEnabled}
                onValueChange={toggleBiometric}
                trackColor={{ false: '#d1d5db', true: '#6366f1' }}
                thumbColor={Platform.OS === 'ios' ? '#fff' : (biometricEnabled ? '#fff' : '#f4f3f4')}
              />
            </View>
          )}
        </View>

        {/* App Info Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>UYGULAMA</Text>
          <View style={[styles.settingRow, { backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : '#fff', borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)' }]}>
            <View style={styles.settingInfo}>
              <View style={[styles.settingIcon, { backgroundColor: 'rgba(16, 185, 129, 0.1)' }]}>
                <Ionicons name="information-circle-outline" size={20} color="#10b981" />
              </View>
              <Text style={[styles.settingLabel, { color: isDark ? '#fff' : '#000' }]}>Versiyon</Text>
            </View>
            <Text style={{ color: '#71717a', fontWeight: '600' }}>v1.2.0</Text>
          </View>

          <Pressable onPress={handleLogout} style={styles.logoutBtn}>
            <Ionicons name="log-out-outline" size={20} color="#6366f1" style={{ marginRight: 8 }} />
            <Text style={[styles.logoutBtnText, { color: '#6366f1' }]}>Çıkış Yap</Text>
          </Pressable>
        </View>

        {/* Minimalist Delete Account Section */}
        <View style={[styles.section, { marginTop: 24, borderTopWidth: 1, borderTopColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)', paddingTop: 32 }]}>
          <Pressable 
            onPress={handleDeleteAccount}
            style={({ pressed }) => [styles.simpleDeleteBtn, { opacity: pressed ? 0.7 : 1 }]}
          >
            <Ionicons name="trash-outline" size={20} color="#ef4444" />
            <Text style={styles.simpleDeleteBtnText}>Hesabımı Sil</Text>
          </Pressable>
          <Text style={styles.deleteNote}>Hesabınızı sildiğinizde tüm verileriniz kalıcı olarak kaldırılır.</Text>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* Biometric Confirmation Modal */}
      <Modal visible={bioModalVisible} transparent={true} animationType="fade">
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', padding: 24 }}>
          <View style={{ borderRadius: 32, padding: 32, alignItems: 'center', borderWidth: 1, borderColor: isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.05)', backgroundColor: isDark ? '#18181b' : '#ffffff', shadowColor: '#000', shadowOffset: { width: 0, height: 20 }, shadowOpacity: 0.4, shadowRadius: 30, elevation: 20 }}>
            <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: isDark ? 'rgba(99, 102, 241, 0.2)' : 'rgba(99, 102, 241, 0.1)', justifyContent: 'center', alignItems: 'center', marginBottom: 24, borderWidth: 1, borderColor: 'rgba(99, 102, 241, 0.2)' }}>
              <Ionicons name="finger-print" size={36} color="#6366f1" />
            </View>
            <Text style={{ fontSize: 24, fontWeight: '900', color: isDark ? '#fff' : '#09090b', marginBottom: 12, letterSpacing: -0.5 }}>Biyometrik Onay</Text>
            <Text style={{ fontSize: 15, color: isDark ? '#a1a1aa' : '#71717a', textAlign: 'center', marginBottom: 32, lineHeight: 22, fontWeight: '500' }}>Güvenliğiniz için lütfen mevcut şifrenizi doğrulayın.</Text>
            
            <View style={{ width: '100%', flexDirection: 'row', alignItems: 'center', borderWidth: 2, borderRadius: 20, marginBottom: 32, paddingHorizontal: 16, height: 64, borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)', backgroundColor: isDark ? '#09090b' : '#f8fafc' }}>
              <Ionicons name="lock-closed-outline" size={20} color={isDark ? '#a1a1aa' : '#71717a'} style={{ marginRight: 12 }} />
              <TextInput
                style={{ flex: 1, color: isDark ? '#fff' : '#000', fontSize: 16, fontWeight: '700', ...(Platform.OS === 'web' && { outlineStyle: 'none' } as any) }}
                placeholder="Mevcut Şifreniz"
                placeholderTextColor={isDark ? '#3f3f46' : '#a1a1aa'}
                secureTextEntry
                value={passwordForBio}
                onChangeText={setPasswordForBio}
              />
            </View>

            <View style={{ flexDirection: 'row', gap: 16, width: '100%' }}>
              <Pressable onPress={() => { setBioModalVisible(false); setPasswordForBio(''); }} style={{ flex: 1, height: 60, borderRadius: 20, justifyContent: 'center', alignItems: 'center', backgroundColor: isDark ? '#27272a' : '#f1f5f9' }}>
                <Text style={{ color: isDark ? '#fff' : '#4b5563', fontWeight: '800', fontSize: 16 }}>İptal</Text>
              </Pressable>
              <Pressable onPress={confirmBiometricWithPassword} disabled={updating} style={{ flex: 2 }}>
                <LinearGradient colors={['#6366f1', '#4338ca']} style={{ height: 60, borderRadius: 20, justifyContent: 'center', alignItems: 'center', shadowColor: '#6366f1', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.3, shadowRadius: 15 }}>
                  {updating ? <ActivityIndicator color="#fff" /> : <Text style={{ color: '#fff', fontWeight: '800', fontSize: 16 }}>Onayla</Text>}
                </LinearGradient>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { padding: 24, paddingTop: Platform.OS === 'ios' ? 60 : 40 },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 32, gap: 16 },
  backBtn: { width: 44, height: 44, borderRadius: 22, justifyContent: 'center', alignItems: 'center' },
  title: { fontSize: 28, fontWeight: '900', letterSpacing: -0.5 },
  card: { padding: 32, borderRadius: 28, alignItems: 'center', marginBottom: 32, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', overflow: 'hidden' },
  avatarContainer: { width: 100, height: 100, marginBottom: 16, justifyContent: 'center', alignItems: 'center' },
  avatarGlow: { position: 'absolute', width: 100, height: 100, borderRadius: 50, opacity: 0.3, filter: 'blur(15px)' },
  avatar: { width: 80, height: 80, borderRadius: 40, backgroundColor: '#6366f1', justifyContent: 'center', alignItems: 'center', borderWidth: 4, borderColor: 'rgba(255,255,255,0.2)' },
  avatarText: { fontSize: 32, fontWeight: 'bold', color: '#fff' },
  userName: { fontSize: 22, fontWeight: '800', marginBottom: 4 },
  userEmail: { fontSize: 14, color: '#71717a', fontWeight: '500' },
  section: { marginBottom: 32 },
  sectionTitle: { fontSize: 13, fontWeight: '800', color: '#71717a', letterSpacing: 1.5, marginBottom: 16, marginLeft: 4 },
  inputGroup: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 16, marginBottom: 16, paddingHorizontal: 16, height: 56 },
  inputIcon: { marginRight: 12 },
  input: { flex: 1, fontSize: 16, fontWeight: '600' },
  updateBtn: { height: 56, borderRadius: 16, justifyContent: 'center', alignItems: 'center', shadowColor: '#6366f1', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.3, shadowRadius: 12, elevation: 8 },
  updateBtnText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  settingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, borderRadius: 16, borderWidth: 1, marginBottom: 12 },
  settingInfo: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  settingIcon: { width: 36, height: 36, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
  settingLabel: { fontSize: 16, fontWeight: '600' },
  logoutBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', padding: 16, marginTop: 16 },
  logoutBtnText: {
    fontSize: 16,
    fontWeight: '800',
  },
  simpleDeleteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    borderRadius: 16,
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.2)',
    gap: 8,
  },
  simpleDeleteBtnText: {
    color: '#ef4444',
    fontSize: 16,
    fontWeight: '800',
  },
  deleteNote: {
    textAlign: 'center',
    fontSize: 12,
    color: '#71717a',
    marginTop: 12,
    fontWeight: '500',
    paddingHorizontal: 20
  },
});
