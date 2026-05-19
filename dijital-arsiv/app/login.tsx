import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Image, Animated, Dimensions } from 'react-native';
import { supabase } from '../src/services/api';
import { router } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../src/context/ThemeContext';
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';

const { width, height } = Dimensions.get('window');

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [isBiometricSupported, setIsBiometricSupported] = useState(false);
  const [biometricEnabled, setBiometricEnabled] = useState(false);
  const { isDark } = useTheme();

  const [fadeAnim] = useState(new Animated.Value(0));
  const [slideAnim] = useState(new Animated.Value(20));
  const [pulseAnim] = useState(new Animated.Value(1));
  const successSlideAnim = useRef(new Animated.Value(-100)).current;

  useEffect(() => {
    // Bileşen yüklendiğinde her şeyi sıfırla
    setShowSuccess(false);
    successSlideAnim.setValue(-100);
    setEmail(''); // E-postayı temizle
    setPassword(''); // Şifreyi temizle

    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 800, useNativeDriver: true })
    ]).start();

    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.05, duration: 2000, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 2000, useNativeDriver: true })
      ])
    ).start();
    
    // Beni hatırla ve biyometrik kontrolü
    const loadSettings = async () => {
      try {
        const savedEmail = await AsyncStorage.getItem('@remembered_email');
        if (savedEmail) {
          setEmail(savedEmail);
          setRememberMe(true);
        }

        const compatible = await LocalAuthentication.hasHardwareAsync();
        const enrolled = await LocalAuthentication.isEnrolledAsync();
        setIsBiometricSupported(compatible && enrolled);

        // Son giriş yapan kullanıcının ID'sini al
        const lastUserId = await AsyncStorage.getItem('@last_user_id');
        if (lastUserId) {
          const bioEnabled = await SecureStore.getItemAsync(`biometric_enabled_${lastUserId}`);
          setBiometricEnabled(bioEnabled === 'true');
        }
      } catch (e) {}
    };
    loadSettings();
  }, []);

  const handleBiometricLogin = async () => {
    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Giriş yapmak için biyometrik verinizi kullanın',
        fallbackLabel: 'Şifre kullan',
      });

      if (result.success) {
        const lastUserId = await AsyncStorage.getItem('@last_user_id');
        if (!lastUserId) {
          Alert.alert('Hata', 'Kayıtlı biyometrik veri bulunamadı.');
          return;
        }

        const credentials = await SecureStore.getItemAsync(`user_credentials_${lastUserId}`);
        if (credentials) {
          const { email: savedEmail, password: savedPassword } = JSON.parse(credentials);
          setLoading(true);
          const { data, error } = await supabase.auth.signInWithPassword({ email: savedEmail, password: savedPassword });
          setLoading(false);
          
          if (!error && data.user) {
            await AsyncStorage.setItem('@last_user_id', data.user.id);
            handleSuccess();
          } else {
            Alert.alert('Hata', 'Biyometrik giriş başarısız: ' + (error?.message || 'Doğrulanamadı'));
          }
        } else {
          Alert.alert('Bilgi', 'Biyometrik giriş için önce şifrenizle bir kez giriş yapmalısınız.');
        }
      }
    } catch (e) {}
  };

  const handleSuccess = () => {
    setShowSuccess(true);
    Animated.spring(successSlideAnim, {
      toValue: Platform.OS === 'ios' ? 60 : 40,
      useNativeDriver: true,
      friction: 8,
      tension: 40
    }).start();

    setTimeout(() => {
      setShowSuccess(false); // Yönlendirmeden hemen önce gizle
      router.replace('/');
    }, 2000);
  };

  const handleLogin = async () => {
    if (!email || !password) {
      if (Platform.OS === 'web') {
        window.alert('Lütfen e-posta ve şifrenizi girin.');
      } else {
        Alert.alert('Hata', 'Lütfen e-posta ve şifrenizi girin.');
      }
      return;
    }

    setLoading(true);
    
    // Beni hatırla kaydı
    try {
      if (rememberMe) {
        await AsyncStorage.setItem('@remembered_email', email);
      } else {
        await AsyncStorage.removeItem('@remembered_email');
      }
    } catch (e) {}

    // Demo hesap otomatik dönüştürme sihri
    let loginEmail = email.trim();
    let loginPassword = password;
    if (
      (loginEmail.toLowerCase() === 'demo' && loginPassword === 'demo') ||
      (loginEmail.toLowerCase() === 'admin' && loginPassword === 'admin')
    ) {
      loginEmail = 'demo@demo.com';
      loginPassword = 'demodemo';
    }

    const { data, error } = await supabase.auth.signInWithPassword({ email: loginEmail, password: loginPassword });
    setLoading(false);

    if (error) {
      if (Platform.OS === 'web') {
        window.alert('Giriş Başarısız: ' + error.message);
      } else {
        Alert.alert('Giriş Başarısız', error.message);
      }
    } else if (data.user) {
      // Başarılı girişte kullanıcı ID'sini kaydet
      await AsyncStorage.setItem('@last_user_id', data.user.id);
      
      // Giriş başarılıysa ve bu kullanıcı için biyometrik aktifse kimlik bilgilerini kaydet
      if (biometricEnabled) {
        await SecureStore.setItemAsync(`user_credentials_${data.user.id}`, JSON.stringify({ email: loginEmail, password: loginPassword }));
      }
      handleSuccess();
    }
  };

  return (
    <View style={styles.container}>
      <LinearGradient colors={isDark ? ['#050505', '#0a0a1a'] : ['#f8fafc', '#e2e8f0']} style={StyleSheet.absoluteFillObject} />
      
      {showSuccess && (
        <Animated.View style={[styles.toastContainer, { transform: [{ translateY: successSlideAnim }] }]}>
          <LinearGradient colors={['#10b981', '#059669']} style={styles.toastGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}>
            <Ionicons name="checkmark-circle" size={24} color="#fff" />
            <Text style={styles.toastText}>Giriş başarılı! Yönlendiriliyorsunuz...</Text>
          </LinearGradient>
        </Animated.View>
      )}

      {/* Background Glowing Orbs */}
      <Animated.View style={[styles.orb1, { transform: [{ scale: pulseAnim }], opacity: isDark ? 0.4 : 0.6 }]} />
      <Animated.View style={[styles.orb2, { transform: [{ scale: pulseAnim }], opacity: isDark ? 0.3 : 0.5 }]} />

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.keyboardView}>
        <Animated.View style={[styles.content, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
          
          <View style={styles.header}>
            <View style={styles.logoContainer}>
              <LinearGradient colors={['#6366f1', '#a855f7']} style={styles.logoGlow} />
              <View style={styles.logoInner}>
                <Image source={require('../assets/images/logo-transparent.png')} style={styles.logo} resizeMode="cover" />
              </View>
            </View>
            <Text style={[styles.title, { color: isDark ? '#ffffff' : '#09090b' }]}>Hoş Geldiniz</Text>
            <Text style={styles.subtitle}>Dijital arşivinize güvenle erişin</Text>
          </View>

          <BlurView intensity={isDark ? 30 : 60} tint={isDark ? "dark" : "light"} style={styles.formContainer}>
            <View style={styles.form}>
              <View style={[styles.inputGroup, { backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.6)', borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)' }]}>
                <Ionicons name="mail-outline" size={20} color={isDark ? '#a1a1aa' : '#71717a'} style={styles.inputIcon} />
                <TextInput
                  style={[styles.input, { color: isDark ? '#ffffff' : '#000000' }]}
                  placeholder="E-posta adresiniz"
                  placeholderTextColor={isDark ? '#52525b' : '#a1a1aa'}
                  value={email}
                  onChangeText={setEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoComplete="off"
                  textContentType="none"
                />
              </View>

              <View style={[styles.inputGroup, { backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.6)', borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)' }]}>
                <Ionicons name="lock-closed-outline" size={20} color={isDark ? '#a1a1aa' : '#71717a'} style={styles.inputIcon} />
                <TextInput
                  style={[styles.input, { color: isDark ? '#ffffff' : '#000000' }]}
                  placeholder="Şifreniz"
                  placeholderTextColor={isDark ? '#52525b' : '#a1a1aa'}
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry={!showPassword}
                  autoComplete="off"
                  textContentType="none"
                />
                <Pressable onPress={() => setShowPassword(!showPassword)} hitSlop={10} style={{ padding: 10 }}>
                  <Ionicons name={showPassword ? "eye-off-outline" : "eye-outline"} size={20} color={isDark ? '#a1a1aa' : '#71717a'} />
                </Pressable>
              </View>

              <View style={styles.rememberMeContainer}>
                <Pressable 
                  onPress={() => setRememberMe(!rememberMe)}
                  style={styles.rememberMeBtn}
                >
                  <View style={[styles.checkbox, { borderColor: rememberMe ? '#6366f1' : (isDark ? '#52525b' : '#d4d4d8'), backgroundColor: rememberMe ? '#6366f1' : 'transparent' }]}>
                    {rememberMe && <Ionicons name="checkmark" size={14} color="#fff" />}
                  </View>
                  <Text style={[styles.rememberMeText, { color: isDark ? '#a1a1aa' : '#71717a' }]}>Beni Hatırla</Text>
                </Pressable>

                {isBiometricSupported && (
                  <Pressable 
                    onPress={handleBiometricLogin} 
                    style={[styles.biometricBtn, { opacity: biometricEnabled ? 1 : 0.5 }]}
                  >
                    <Ionicons name="finger-print" size={24} color={biometricEnabled ? "#6366f1" : (isDark ? "#52525b" : "#a1a1aa")} />
                  </Pressable>
                )}
              </View>

              <Pressable 
                style={({ pressed }) => [styles.loginButton, { opacity: pressed || loading ? 0.8 : 1 }]} 
                onPress={handleLogin}
                disabled={loading}
              >
                <LinearGradient colors={['#6366f1', '#4338ca']} style={styles.loginGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}>
                  {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.loginButtonText}>Giriş Yap</Text>}
                </LinearGradient>
              </Pressable>

              <Pressable onPress={() => router.push('/register')} style={styles.linkButton}>
                <Text style={[styles.linkText, { color: isDark ? '#a1a1aa' : '#71717a' }]}>
                  Hesabınız yok mu? <Text style={{ color: '#6366f1', fontWeight: 'bold' }}>Hemen Kayıt Olun</Text>
                </Text>
              </Pressable>
            </View>
          </BlurView>
        </Animated.View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  orb1: { position: 'absolute', top: -height * 0.1, left: -width * 0.2, width: width * 0.8, height: width * 0.8, borderRadius: width * 0.4, backgroundColor: '#6366f1', filter: 'blur(80px)' },
  orb2: { position: 'absolute', bottom: -height * 0.1, right: -width * 0.2, width: width * 0.8, height: width * 0.8, borderRadius: width * 0.4, backgroundColor: '#a855f7', filter: 'blur(80px)' },
  keyboardView: { flex: 1 },
  content: { flex: 1, justifyContent: 'center', padding: 24, maxWidth: 500, width: '100%', alignSelf: 'center' },
  header: { alignItems: 'center', marginBottom: 40 },
  logoContainer: { width: 90, height: 90, justifyContent: 'center', alignItems: 'center', marginBottom: 24 },
  logoGlow: { position: 'absolute', width: '100%', height: '100%', borderRadius: 45, opacity: 0.5, filter: 'blur(15px)' },
  logoInner: { width: 80, height: 80, borderRadius: 40, backgroundColor: '#ffffff', justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: 'rgba(255,255,255,0.5)', overflow: 'hidden' },
  logo: { width: '100%', height: '100%' },
  title: { fontSize: 32, fontWeight: '900', marginBottom: 8, letterSpacing: 0.5 },
  subtitle: { fontSize: 16, color: '#71717a' },
  formContainer: { borderRadius: 24, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  form: { padding: 24, gap: 16 },
  inputGroup: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 16, overflow: 'hidden' },
  inputIcon: { paddingLeft: 16, paddingRight: 8 },
  input: { flex: 1, paddingVertical: 18, fontSize: 16, ...(Platform.OS === 'web' && { outlineStyle: 'none' } as any) },
  loginButton: { borderRadius: 16, overflow: 'hidden', marginTop: 8, shadowColor: '#6366f1', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.3, shadowRadius: 12, elevation: 8 },
  loginGradient: { paddingVertical: 18, alignItems: 'center', justifyContent: 'center' },
  loginButtonText: { color: '#ffffff', fontSize: 16, fontWeight: 'bold', letterSpacing: 0.5 },
  linkButton: { alignItems: 'center', marginTop: 12, padding: 10 },
  linkText: { fontSize: 14 },
  toastContainer: { position: 'absolute', top: 0, left: 0, right: 0, alignItems: 'center', zIndex: 100 },
  toastGradient: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 24, borderRadius: 30, gap: 10, shadowColor: '#10b981', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.3, shadowRadius: 10, elevation: 8 },
  toastText: { color: '#fff', fontSize: 15, fontWeight: '700', letterSpacing: 0.3 },
  rememberMeContainer: { marginBottom: 20, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rememberMeBtn: { flexDirection: 'row', alignItems: 'center' },
  checkbox: { width: 20, height: 20, borderRadius: 6, borderWidth: 2, justifyContent: 'center', alignItems: 'center', marginRight: 10 },
  rememberMeText: { fontSize: 14, fontWeight: '500' },
  biometricBtn: { width: 44, height: 44, borderRadius: 12, backgroundColor: 'rgba(99, 102, 241, 0.1)', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: 'rgba(99, 102, 241, 0.2)' }
});
