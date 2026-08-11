import type { Config } from 'tailwindcss';

// =====================================================================
// B.R.A.N.D 2.0 — Tailwind 디자인 토큰
// =====================================================================
// v4 대시보드 디자인 그대로 시스템화.
// 
// 핵심 원칙:
//   - 모든 색상·간격·반경·그림자는 토큰으로
//   - 매직 넘버 0개 (인라인 색상 X)
//   - 다크 테마 기본 (라이트 추후 옵션)
//   - 한국어 친화 폰트 스택 (Pretendard + Nunito + Black Han Sans)
// =====================================================================

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',  // 추후 라이트 모드 토글 대비
  
  theme: {
    extend: {
      // ============================================================
      // 색상 — v4 디자인 그대로
      // ============================================================
      colors: {
        // 배경 (다크 기본)
        bg: {
          base: '#1A1625',
          deep: '#0F0B1A',
          soft: '#2A2438',
          card: 'rgba(15, 11, 26, 0.85)',     // 카드 (백드롭 블러 적용)
          overlay: 'rgba(15, 11, 26, 0.95)',  // 강한 오버레이 (네비 등)
        },
        
        // 브랜드 액센트 (주황·골드)
        brand: {
          DEFAULT: '#FF8C42',
          primary: '#FF8C42',
          glow: '#FFB347',
          dark: '#C46627',
          50: '#FFF3EB',
          100: '#FFE3D1',
          200: '#FFC4A3',
          300: '#FFA575',
          400: '#FF8C42',
          500: '#FF6F1A',
          600: '#E55400',
          700: '#B84300',
          800: '#8A3200',
          900: '#5C2100',
        },
        
        // 화폐 색상 (가치 토큰별)
        gold: {
          DEFAULT: '#FFD93D',
          50: '#FFFBEB',
          100: '#FFF4C7',
          200: '#FFEA8F',
          300: '#FFE057',
          400: '#FFD93D',
          500: '#E5B800',
          600: '#B89200',
        },
        crystal: {
          DEFAULT: '#4ECDC4',
          50: '#E8F8F7',
          100: '#C5EFEB',
          200: '#8FE0D8',
          300: '#69D3CB',
          400: '#4ECDC4',
          500: '#2BB5AB',
          600: '#1F8B83',
        },
        bv: {
          DEFAULT: '#B197FC',   // BV — 명예 점수의 보라
          50: '#F5F1FE',
          100: '#E5DCFE',
          200: '#CDBAFE',
          300: '#B197FC',
          400: '#9577F8',
          500: '#7956F2',
          600: '#5F3FE0',
        },
        
        // 텍스트
        text: {
          primary: '#FFFFFF',
          secondary: '#B8B0CC',
          muted: '#6B647A',
          faded: '#4A4458',
        },
        
        // 시스템 색상
        success: {
          DEFAULT: '#6BCB77',
          bg: 'rgba(75, 200, 117, 0.25)',
        },
        danger: {
          DEFAULT: '#FF4757',
          bg: 'rgba(255, 71, 87, 0.25)',
        },
        warning: {
          DEFAULT: '#FFC857',
          bg: 'rgba(255, 200, 87, 0.25)',
        },
        
        // 22 티어 색상 (모든 티어에 대응)
        tier: {
          seedling: '#94A39E',        // 새싹
          bronze: '#A77449',          // 브론즈
          'bronze-shine': '#C99052',  // 빛나는 브론즈
          'silver-rough': '#9CA3AF',  // 거친 실버
          'silver-grow': '#BCC2CC',   // 성장한 실버
          'silver-evolved': '#D5DBE3', // 진화한 실버
          'silver-peak': '#E8EDF3',   // 은빛 극점
          'gold-ore': '#D4A847',      // 금 광석
          'gold-refined': '#FFC857',  // 제련된 골드
          'gold-purified': '#FFD060', // 정련된 골드
          'gold-sun': '#FFD93D',      // 태양의 황금
          'ruby-rough': '#C44848',    // 루비 원석
          'ruby-polished': '#DC4848', // 연마된 루비
          'ruby-awakened': '#E84848', // 각성한 루비
          'ruby-peak': '#FF3D5C',     // 홍염의 정점
          'diamond-rough': '#7EC4E8', // 다이아 원석
          'diamond-cut': '#9DD5F0',   // 세공된 다이아
          'diamond-pure': '#BCE5F8',  // 무결 다이아
          'eternal': '#E0F4FF',       // 영원의 결정
          master: '#B197FC',          // 마스터
          'master-celestial': '#D4C4FE', // 천상의 마스터
          grandmaster: '#FFD93D',     // 그랜드마스터 (최고 골드)
        },
        
        // 업적 등급 색상
        grade: {
          rare: '#9CA3AF',      // 희귀
          unique: '#3B82F6',    // 유니크
          epic: '#A855F7',      // 에픽
          transcendent: '#F59E0B', // 초월
          only: '#EF4444',      // 유일
          hidden: '#000000',    // 히든
        },
        
        // 경계선·라인
        line: {
          DEFAULT: 'rgba(255, 255, 255, 0.08)',
          strong: 'rgba(255, 255, 255, 0.15)',
          brand: 'rgba(255, 140, 66, 0.4)',
        },
      },
      
      // ============================================================
      // 폰트
      // ============================================================
      fontFamily: {
        // 기본 (한국어 + 영어 + 숫자)
        sans: ['"Pretendard Variable"', 'Pretendard', 'Nunito', '-apple-system', 'sans-serif'],

        // 강조 (큰 숫자·헤더) — Black Han Sans는 너무 굵어 가독성 저하 → Pretendard 굵은 굵기로 대체
        display: ['"Pretendard Variable"', 'Pretendard', 'Nunito', 'sans-serif'],

        // 손글씨 (액센트·격려 문구)
        handwriting: ['Gaegu', 'Nunito', 'sans-serif'],
        
        // 모노스페이스 (코드·UID)
        mono: ['"JetBrains Mono"', 'monospace'],
      },
      
      fontSize: {
        // 사용자 정의 크기 (v4 디자인 기반)
        '2xs': '0.625rem',  // 10px
        'xs-tight': ['0.6875rem', { lineHeight: '1' }],  // 11px
      },
      
      // ============================================================
      // 간격 — 일관된 스케일
      // ============================================================
      spacing: {
        '0.5': '0.125rem',
        '1.5': '0.375rem',
        '2.5': '0.625rem',
        '3.5': '0.875rem',
      },
      
      // ============================================================
      // 모서리 반경
      // ============================================================
      borderRadius: {
        // v4 디자인 그대로
        'pill': '9999px',
        'card-sm': '12px',
        'card-md': '14px',
        'card-lg': '16px',
        'card-xl': '20px',
        '4xl': '28px',
      },
      
      // ============================================================
      // 그림자
      // ============================================================
      boxShadow: {
        // 브랜드 그림자
        'brand-sm': '0 4px 12px rgba(255, 140, 66, 0.3)',
        'brand-md': '0 8px 24px rgba(255, 140, 66, 0.4)',
        'brand-lg': '0 12px 32px rgba(255, 140, 66, 0.5)',
        'brand-glow': '0 0 20px rgba(255, 217, 61, 0.6)',
        
        // BV 그림자 (보라)
        'bv-sm': '0 4px 12px rgba(177, 151, 252, 0.3)',
        'bv-md': '0 8px 24px rgba(177, 151, 252, 0.4)',
        
        // 카드 일반
        'card': '0 4px 16px rgba(0, 0, 0, 0.4)',
        'card-hover': '0 8px 24px rgba(255, 140, 66, 0.3)',
        
        // 인셋 효과 (티어 이미지)
        'tier-inset': 'inset 0 -8px 16px rgba(0,0,0,0.3), inset 0 4px 8px rgba(255,255,255,0.3)',
      },
      
      // ============================================================
      // 백드롭 블러 (글래스모피즘)
      // ============================================================
      backdropBlur: {
        'card': '20px',
      },
      
      // ============================================================
      // 애니메이션
      // ============================================================
      animation: {
        'pulse-border': 'pulseBorder 2s ease-in-out infinite',
        'twinkle': 'twinkle 3s infinite',
        'shimmer': 'shimmer 2s linear infinite',
        'float': 'float 3s ease-in-out infinite',
      },
      
      keyframes: {
        pulseBorder: {
          '0%, 100%': { borderColor: 'rgba(255, 140, 66, 0.4)' },
          '50%': { 
            borderColor: 'rgba(255, 140, 66, 1)',
            boxShadow: '0 0 16px rgba(255, 140, 66, 0.3)'
          },
        },
        twinkle: {
          '0%, 100%': { opacity: '0.3' },
          '50%': { opacity: '1' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-4px)' },
        },
      },
      
      // ============================================================
      // 화면 너비 — 모바일 우선 (학생 사용 기기)
      // ============================================================
      screens: {
        'xs': '380px',
        'sm': '480px',
        'md': '768px',
        'lg': '1024px',
        'xl': '1280px',
      },
      
      // 최대 컨테이너 너비 (모바일 앱 느낌)
      maxWidth: {
        'app': '480px',
      },
    },
  },
  
  plugins: [],
} satisfies Config;
