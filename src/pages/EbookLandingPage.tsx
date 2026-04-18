import { useState, useCallback } from "react";
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import pcsLogo from "@/assets/pcs-logo.png";
import { motion } from "framer-motion";
import {
  BookOpen,
  Zap,
  Image as ImageIcon,
  Video,
  DollarSign,
  Brain,
  CheckCircle,
  ArrowRight,
  Star,
  Shield,
  Clock,
  Download,
  ChevronDown,
  ChevronUp,
  MessageSquare,
  Sparkles,
  Target,
  ShoppingBag,
  User,
  Menu,
  X,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Link, useNavigate } from "react-router-dom";
import defaultLogo from "@/assets/site-logo.png";
import ebookCover from "@/assets/ebook-cover.jpeg";

export default function EbookLandingPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [billingForm, setBillingForm] = useState({ name: '', email: '', phone: '' });
  const [billingErrors, setBillingErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleBillingChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setBillingForm(prev => ({ ...prev, [name]: value }));
    setBillingErrors(prev => ({ ...prev, [name]: '' }));
  };

  const handleOrder = useCallback(async () => {
    const errors: Record<string, string> = {};
    if (!billingForm.name.trim()) errors.name = 'নাম দিন';
    if (!billingForm.email.trim()) errors.email = 'ইমেইল দিন';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(billingForm.email)) errors.email = 'সঠিক ইমেইল দিন';
    if (billingForm.phone && !/^01[3-9]\d{8}$/.test(billingForm.phone.trim())) errors.phone = 'সঠিক ফোন নম্বর দিন';

    if (Object.keys(errors).length > 0) {
      setBillingErrors(errors);
      return;
    }

    setIsSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke('place-order', {
        body: {
          userId: null,
          items: [{
            productId: 'ai-prompt-mastery',
            quantity: 1,
            productName: 'AI Prompt Mastery (PDF)',
            productImage: null,
            price: 199,
          }],
          shipping: {
            name: billingForm.name.trim(),
            phone: billingForm.phone.trim() || '01300000000',
            address: `Email: ${billingForm.email.trim()}`,
          },
          orderSource: 'landing_page',
          shippingCostOverride: 0,
        },
      });

      if (error || data?.error) {
        throw new Error(data?.error || 'অর্ডার করতে সমস্যা হয়েছে');
      }

      // Store order confirmation data for after payment redirect
      const confirmationData = {
        orderNumber: data.orderNumber,
        customerName: billingForm.name,
        phone: billingForm.phone || undefined,
        total: data.total,
        items: [{
          productId: 'ai-prompt-mastery',
          productName: 'AI Prompt Mastery',
          price: 199,
          quantity: 1,
        }],
        fromLandingPage: true,
        customerEmail: billingForm.email.trim(),
      };
      sessionStorage.setItem('pending_order_confirmation', JSON.stringify(confirmationData));

      // Initialize EPS payment via direct API
      const successUrl = `${window.location.origin}/order-confirmation`;
      const failUrl = `${window.location.origin}/payment-failed`;
      const initRes = await supabase.functions.invoke('eps-initiate', {
        body: {
          order_number: data.orderNumber,
          amount: data.total,
          customer_name: billingForm.name,
          customer_email: billingForm.email.trim(),
          customer_phone: billingForm.phone || '01000000000',
          customer_address: 'Digital Delivery',
          product_name: 'AI Prompt Mastery (PDF)',
          success_url: successUrl,
          fail_url: failUrl,
          cancel_url: failUrl,
        },
      });

      if (initRes.error || !initRes.data?.redirectUrl) {
        throw new Error(initRes.data?.error || initRes.error?.message || 'পেমেন্ট গেটওয়ে সমস্যা');
      }

      window.location.href = initRes.data.redirectUrl;
    } catch (err: any) {
      toast({
        title: 'অর্ডার ব্যর্থ',
        description: err.message || 'আবার চেষ্টা করুন',
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  }, [billingForm, navigate, toast]);

  const features = [
    {
      icon: <Brain className="w-7 h-7" />,
      title: "ChatGPT মাস্টার করুন",
      desc: "সঠিক প্রম্পট দিয়ে ChatGPT থেকে প্রফেশনাল আউটপুট পান, র‍্যান্ডম রেজাল্ট নয়",
    },
    {
      icon: <ImageIcon className="w-7 h-7" />,
      title: "High-End ফটো জেনারেট",
      desc: "AI দিয়ে প্রফেশনাল কোয়ালিটির ফটো তৈরি করুন - স্টক ফটোর দিন শেষ",
    },
    {
      icon: <Video className="w-7 h-7" />,
      title: "ভিডিও জেনারেশন",
      desc: "AI Prompt দিয়ে ভিডিও তৈরি করুন - কন্টেন্ট ক্রিয়েশন এখন আরো সহজ",
    },
    {
      icon: <DollarSign className="w-7 h-7" />,
      title: "ফ্রিল্যান্সিং ইনকাম",
      desc: "AI Prompt Mastery দিয়ে ফ্রিল্যান্সিং করে টাকা ইনকাম করুন",
    },
    {
      icon: <Target className="w-7 h-7" />,
      title: "Nano Banana মাস্টারি",
      desc: "সঠিক প্রম্পট টেকনিক শিখুন - proper result পান, random নয়",
    },
    {
      icon: <Sparkles className="w-7 h-7" />,
      title: "সহজ বাংলায় লেখা",
      desc: "ছোট বাচ্চাও বুঝবে এমন সহজ বাংলায় সব কনসেপ্ট ব্যাখ্যা করা হয়েছে",
    },
  ];

  const benefits = [
    "ChatGPT দিয়ে প্রফেশনাল কন্টেন্ট তৈরি",
    "AI দিয়ে হাই-এন্ড ফটো জেনারেট",
    "ভিডিও জেনারেশন টেকনিক",
    "ফ্রিল্যান্সিং গাইড ও ইনকাম টিপস",
    "প্রম্পট ইঞ্জিনিয়ারিং এর A to Z",
    "লাইফটাইম আপডেট ফ্রি",
  ];

  const testimonials = [
    {
      name: "রাহাত হোসেন",
      role: "ফ্রিল্যান্সার",
      text: "এই ebook পড়ে আমি ChatGPT থেকে একদম ভিন্ন লেভেলের আউটপুট পাচ্ছি। ফ্রিল্যান্সিং এ অনেক কাজে লাগছে।",
      rating: 5,
    },
    {
      name: "তানভীর আহমেদ",
      role: "কন্টেন্ট ক্রিয়েটর",
      text: "AI দিয়ে ফটো জেনারেট করার টেকনিকগুলো অসাধারণ। আমার কন্টেন্ট কোয়ালিটি অনেক বেড়েছে।",
      rating: 5,
    },
    {
      name: "নাফিসা আক্তার",
      role: "ডিজিটাল মার্কেটার",
      text: "সহজ বাংলায় লেখা, সব কনসেপ্ট ক্লিয়ার। AI নিয়ে কাজ করতে গেলে এই ebook মাস্ট।",
      rating: 5,
    },
  ];

  const faqs = [
    {
      q: "এই ebook কাদের জন্য?",
      a: "যারা AI দিয়ে কাজ করতে চান, ফ্রিল্যান্সিং করতে চান, কন্টেন্ট তৈরি করতে চান - সবার জন্য। বিগিনার থেকে এডভান্সড সবাই উপকৃত হবেন।",
    },
    {
      q: "ebook এর ফরম্যাট কি?",
      a: "PDF ফরম্যাটে পাবেন। যেকোনো ডিভাইসে পড়তে পারবেন - মোবাইল, ট্যাব, কম্পিউটার।",
    },
    {
      q: "আপডেট কি ফ্রি?",
      a: "হ্যাঁ! একবার কিনলে সব ফিউচার আপডেট ফ্রি পাবেন। AI প্রতিনিয়ত আপডেট হচ্ছে, আমাদের ebook ও আপডেট হবে।",
    },
    {
      q: "পেমেন্ট কিভাবে করব?",
      a: "bKash, Nagad, রকেট সহ বিভিন্ন মোবাইল ব্যাংকিং দিয়ে পেমেন্ট করতে পারবেন।",
    },
    {
      q: "ebook কবে পাব?",
      a: "পেমেন্ট কনফার্ম হওয়ার সাথে সাথেই ডাউনলোড লিংক পাবেন। ইন্সট্যান্ট ডেলিভারি!",
    },
  ];

  const scrollToOrder = () => {
    document.getElementById("order-section")?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <div className="min-h-screen bg-background font-sans">
      {/* Header + Hero wrapper for seamless gradient */}
      <div style={{ background: "var(--gradient-hero)" }}>
      {/* Header */}
      <header className="sticky top-0 z-50 bg-transparent backdrop-blur-sm">
        <div className="container-custom py-3">
          <div className="flex items-center justify-between">
            <Link to="/" className="flex items-center">
              <img src={pcsLogo} alt="Pixelcraft Studio" className="h-10 w-auto rounded-lg" />
            </Link>

            <nav className="hidden md:flex items-center gap-6">
              <a
                href="#features"
                className="text-sm font-medium text-white/70 hover:text-white transition-colors"
              >
                ফিচার্স
              </a>
              <a
                href="#reviews"
                className="text-sm font-medium text-white/70 hover:text-white transition-colors"
              >
                রিভিউ
              </a>
              <a href="#faq" className="text-sm font-medium text-white/70 hover:text-white transition-colors">
                FAQ
              </a>
            </nav>

            <div className="flex items-center gap-2">
              <Button
                onClick={scrollToOrder}
                className="bg-primary hover:bg-primary/90 text-primary-foreground rounded-full px-6"
              >
                অর্ডার করুন <ArrowRight className="ml-2 w-4 h-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="md:hidden"
                onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              >
                {isMobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="relative overflow-hidden py-16 md:py-24">
        <div className="absolute inset-0 opacity-10">
          <div
            className="absolute inset-0"
            style={{
              backgroundImage: `radial-gradient(circle at 25% 25%, hsl(195 70% 70% / 0.3) 0%, transparent 50%),
                              radial-gradient(circle at 75% 75%, hsl(195 60% 45% / 0.2) 0%, transparent 50%)`,
            }}
          />
        </div>

        <div className="container-custom relative z-10">
          <div className="grid md:grid-cols-2 gap-12 items-center">
            <motion.div initial={{ opacity: 0, x: -30 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.6 }}>
              <Badge className="mb-4 bg-accent/20 text-accent border-accent/30 font-medium">
                🚀 বাংলায় প্রথম AI Prompt গাইড
              </Badge>
              <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold mb-6 leading-tight text-white font-display">
                AI Prompt
                <span className="block text-accent">Mastery</span>
              </h1>
              <p className="text-lg md:text-xl text-white/80 mb-8 leading-relaxed">
                ChatGPT, Nano Banana, AI Photo & Video Generation — সব কিছু মাস্টার করুন সঠিক প্রম্পট দিয়ে।
                ফ্রিল্যান্সিং করে ইনকাম শুরু করুন আজই!
              </p>

              <div className="flex flex-wrap gap-4 mb-8">
                <Button
                  size="lg"
                  onClick={scrollToOrder}
                  className="bg-accent text-accent-foreground hover:bg-accent/90 rounded-full px-8 text-lg font-semibold shadow-lg"
                >
                  এখনই অর্ডার করুন <ArrowRight className="ml-2 w-5 h-5" />
                </Button>
                <Button
                  size="lg"
                  variant="outline"
                  onClick={() => document.getElementById('features')?.scrollIntoView({ behavior: 'smooth' })}
                  className="border-white/30 text-white hover:bg-white/10 rounded-full px-8"
                >
                  <BookOpen className="mr-2 w-5 h-5" /> বিস্তারিত দেখুন
                </Button>
              </div>

              <div className="flex items-center gap-6 text-white/70">
                <div className="flex items-center gap-2">
                  <Download className="w-4 h-4" />
                  <span className="text-sm">ইন্সট্যান্ট ডেলিভারি</span>
                </div>
                <div className="flex items-center gap-2">
                  <Shield className="w-4 h-4" />
                  <span className="text-sm">লাইফটাইম আপডেট</span>
                </div>
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, x: 30 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.6, delay: 0.2 }}
              className="flex justify-center"
            >
              <div className="relative">
                <div className="absolute -inset-4 bg-accent/20 blur-3xl rounded-full" />
                <img
                  src={ebookCover}
                  alt="AI Prompt Mastery Ebook"
                  className="relative w-[320px] md:w-[400px] rounded-2xl shadow-2xl border border-white/10"
                />
              </div>
            </motion.div>
          </div>
        </div>
      </section>
      </div>

      {/* Problem Section */}
      <section className="py-16 bg-secondary/30">
        <div className="container-custom">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center max-w-3xl mx-auto"
          >
            <h2 className="text-3xl md:text-4xl font-bold mb-6 font-display">
              আপনিও কি এই <span className="text-primary">সমস্যাগুলো</span> ফেস করছেন?
            </h2>
            <div className="grid sm:grid-cols-2 gap-4 mt-8">
              {[
                "😕 ChatGPT তে র‍্যান্ডম রেজাল্ট আসে",
                "😤 AI দিয়ে ভালো ফটো জেনারেট হয় না",
                "😰 প্রম্পট কিভাবে লিখতে হয় জানি না",
                "😞 ফ্রিল্যান্সিং শুরু করতে পারছি না",
              ].map((problem, i) => (
                <div key={i} className="bg-card rounded-xl p-4 text-left border border-border shadow-sm">
                  <p className="text-foreground font-medium">{problem}</p>
                </div>
              ))}
            </div>
            <p className="mt-8 text-lg text-muted-foreground">
              এই সব সমস্যার <span className="text-primary font-semibold">একটাই সমাধান</span> — সঠিক প্রম্পট টেকনিক শেখা!
            </p>
          </motion.div>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="py-16 md:py-20 bg-background">
        <div className="container-custom">
          <div className="text-center mb-12">
            <Badge className="mb-4 bg-primary/10 text-primary border-primary/20">ebook এ কি কি আছে</Badge>
            <h2 className="text-3xl md:text-4xl font-bold font-display">
              এই Ebook এ যা যা <span className="text-primary">শিখবেন</span>
            </h2>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {features.map((feature, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1 }}
                className="group bg-card rounded-2xl p-6 border border-border hover:border-primary/30 hover:shadow-lg transition-all"
              >
                <div className="w-14 h-14 rounded-xl bg-primary/10 flex items-center justify-center text-primary mb-4 group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                  {feature.icon}
                </div>
                <h3 className="text-lg font-bold mb-2 font-display">{feature.title}</h3>
                <p className="text-muted-foreground leading-relaxed">{feature.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Benefits Checklist */}
      <section className="py-16" style={{ background: "var(--gradient-dark)" }}>
        <div className="container-custom">
          <div className="grid md:grid-cols-2 gap-12 items-center">
            <div>
              <h2 className="text-3xl md:text-4xl font-bold text-white mb-8 font-display">
                ebook কিনলে আপনি <span className="text-accent">পাচ্ছেন</span>
              </h2>
              <div className="space-y-4">
                {benefits.map((benefit, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, x: -20 }}
                    whileInView={{ opacity: 1, x: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: i * 0.1 }}
                    className="flex items-center gap-3"
                  >
                    <CheckCircle className="w-6 h-6 text-accent flex-shrink-0" />
                    <span className="text-white/90 text-lg">{benefit}</span>
                  </motion.div>
                ))}
              </div>
            </div>

            <div className="flex justify-center">
              <div className="relative">
                <div className="absolute -inset-6 bg-accent/10 blur-3xl rounded-full" />
                <div className="relative bg-white/5 backdrop-blur rounded-2xl p-8 border border-white/10">
                  <div className="text-center">
                    <Zap className="w-12 h-12 text-accent mx-auto mb-4" />
                    <h3 className="text-2xl font-bold text-white mb-2 font-display">Zero to Pro</h3>
                    <p className="text-white/60 mb-6">কোনো পূর্ব অভিজ্ঞতা ছাড়াই শুরু করুন</p>
                    <div className="flex items-center justify-center gap-1 mb-4">
                      {[1, 2, 3, 4, 5].map((s) => (
                        <Star key={s} className="w-5 h-5 fill-accent text-accent" />
                      ))}
                    </div>
                    <p className="text-white/50 text-sm">৫০০+ মানুষ ইতিমধ্যে শিখছে</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Testimonials */}
      <section id="reviews" className="py-16 md:py-20 bg-background">
        <div className="container-custom">
          <div className="text-center mb-12">
            <Badge className="mb-4 bg-primary/10 text-primary border-primary/20">কাস্টমার রিভিউ</Badge>
            <h2 className="text-3xl md:text-4xl font-bold font-display">
              যারা পড়েছেন তারা <span className="text-primary">কি বলছেন</span>
            </h2>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {testimonials.map((t, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1 }}
                className="bg-card rounded-2xl p-6 border border-border"
              >
                <div className="flex items-center gap-1 mb-4">
                  {Array.from({ length: t.rating }).map((_, j) => (
                    <Star key={j} className="w-4 h-4 fill-accent text-accent" />
                  ))}
                </div>
                <p className="text-foreground mb-4 leading-relaxed">"{t.text}"</p>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                    <User className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <p className="font-semibold text-foreground">{t.name}</p>
                    <p className="text-sm text-muted-foreground">{t.role}</p>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Order Section */}
      <section id="order-section" className="py-16 md:py-20" style={{ background: "var(--gradient-cta)" }}>
        <div className="container-custom">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="max-w-2xl mx-auto text-center"
          >
            <Badge className="mb-4 bg-accent/20 text-accent border-accent/30">🔥 লিমিটেড অফার</Badge>
            <h2 className="text-3xl md:text-4xl font-bold text-white mb-4 font-display">এখনই অর্ডার করুন</h2>
            <p className="text-white/70 text-lg mb-8">AI Prompt Mastery ebook — আপনার AI জার্নি শুরু হোক আজই</p>

            <div className="bg-white/10 backdrop-blur-md rounded-2xl p-8 border border-white/20">
              <div className="mb-6">
                <h3 className="text-2xl font-bold text-white font-display mb-2">AI Prompt Mastery</h3>
                <p className="text-white/60">Complete Guide — PDF Format</p>
              </div>

              <div className="flex items-center justify-center gap-4 mb-6">
                <span className="text-2xl line-through text-muted-foreground font-display">৳৩৯৯</span>
                <span className="text-4xl font-bold text-accent font-display">৳১৯৯</span>
              </div>

              <div className="space-y-3 mb-8 text-left max-w-sm mx-auto">
                {[
                  "সম্পূর্ণ ebook (PDF)",
                  "লাইফটাইম ফ্রি আপডেট",
                  "ইন্সট্যান্ট ডেলিভারি",
                  "বোনাস: প্রম্পট টেমপ্লেট প্যাক",
                ].map((item, i) => (
                  <div key={i} className="flex items-center gap-3 text-white/80">
                    <CheckCircle className="w-5 h-5 text-accent flex-shrink-0" />
                    <span>{item}</span>
                  </div>
                ))}
              </div>

              {/* Billing Form */}
              <div className="space-y-3 mb-6 max-w-sm mx-auto text-left">
                <div>
                  <input
                    type="text"
                    name="name"
                    placeholder="আপনার নাম *"
                    value={billingForm.name}
                    onChange={handleBillingChange}
                    className="w-full px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-white placeholder:text-white/40 focus:outline-none focus:border-accent/60 focus:ring-1 focus:ring-accent/40 transition-all"
                  />
                  {billingErrors.name && <p className="text-red-400 text-xs mt-1">{billingErrors.name}</p>}
                </div>
                <div>
                  <input
                    type="email"
                    name="email"
                    placeholder="ইমেইল *"
                    value={billingForm.email}
                    onChange={handleBillingChange}
                    className="w-full px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-white placeholder:text-white/40 focus:outline-none focus:border-accent/60 focus:ring-1 focus:ring-accent/40 transition-all"
                  />
                  {billingErrors.email && <p className="text-red-400 text-xs mt-1">{billingErrors.email}</p>}
                </div>
                <div>
                  <input
                    type="tel"
                    name="phone"
                    placeholder="ফোন নম্বর (ঐচ্ছিক)"
                    value={billingForm.phone}
                    onChange={handleBillingChange}
                    className="w-full px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-white placeholder:text-white/40 focus:outline-none focus:border-accent/60 focus:ring-1 focus:ring-accent/40 transition-all"
                  />
                  {billingErrors.phone && <p className="text-red-400 text-xs mt-1">{billingErrors.phone}</p>}
                </div>
              </div>

              <Button
                size="lg"
                onClick={handleOrder}
                disabled={isSubmitting}
                className="w-full bg-accent text-accent-foreground hover:bg-accent/90 rounded-full text-lg font-bold py-6 shadow-lg"
              >
                {isSubmitting ? (
                  <><Loader2 className="mr-2 w-5 h-5 animate-spin" /> অর্ডার হচ্ছে...</>
                ) : (
                  <><ShoppingBag className="mr-2 w-5 h-5" /> এখনই অর্ডার করুন — <span className="line-through opacity-70 mr-1">৳৩৯৯</span> ৳১৯৯</>
                )}
              </Button>
              <p className="text-white/40 text-sm mt-4">🔒 সম্পূর্ণ নিরাপদ পেমেন্ট</p>
            </div>
          </motion.div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="py-16 md:py-20 bg-background">
        <div className="container-custom max-w-3xl">
          <div className="text-center mb-12">
            <Badge className="mb-4 bg-primary/10 text-primary border-primary/20">সাধারণ প্রশ্ন</Badge>
            <h2 className="text-3xl md:text-4xl font-bold font-display">
              সচরাচর <span className="text-primary">জিজ্ঞাসা</span>
            </h2>
          </div>

          <div className="space-y-3">
            {faqs.map((faq, i) => (
              <div key={i} className="bg-card rounded-xl border border-border overflow-hidden">
                <button
                  onClick={() => setOpenFaq(openFaq === i ? null : i)}
                  className="w-full flex items-center justify-between p-5 text-left"
                >
                  <span className="font-semibold text-foreground">{faq.q}</span>
                  {openFaq === i ? (
                    <ChevronUp className="w-5 h-5 text-primary flex-shrink-0" />
                  ) : (
                    <ChevronDown className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                  )}
                </button>
                {openFaq === i && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    className="px-5 pb-5"
                  >
                    <p className="text-muted-foreground leading-relaxed">{faq.a}</p>
                  </motion.div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 border-t border-border bg-secondary/30">
        <div className="container-custom">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="flex items-center gap-3">
              <img src={pcsLogo} alt="Pixelcraft Studio" className="h-8 w-auto rounded-lg" />
              <span className="font-display font-bold">Pixelcraft Studio</span>
            </div>
            <div className="flex items-center gap-6">
              <Link to="/about" className="text-sm text-muted-foreground hover:text-primary transition-colors">
                আমাদের সম্পর্কে
              </Link>
              <Link to="/contact" className="text-sm text-muted-foreground hover:text-primary transition-colors">
                যোগাযোগ
              </Link>
              <a href="#faq" className="text-sm text-muted-foreground hover:text-primary transition-colors">
                FAQ
              </a>
            </div>
            <p className="text-sm text-muted-foreground">
              © {new Date().getFullYear()} Pixelcraft Studio. All rights reserved.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
