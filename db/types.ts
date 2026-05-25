export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      appointment_services: {
        Row: {
          appointment_id: string
          price_snapshot: number
          service_id: string
        }
        Insert: {
          appointment_id: string
          price_snapshot: number
          service_id: string
        }
        Update: {
          appointment_id?: string
          price_snapshot?: number
          service_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointment_services_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_services_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      appointments: {
        Row: {
          barber_id: string
          client_id: string
          created_at: string
          deposit_amount_cents: number
          end_at: string
          google_event_id: string | null
          id: string
          notes: string | null
          payment_intent_id: string | null
          payment_status: Database["public"]["Enums"]["appointment_payment_status"]
          shop_id: string
          source: Database["public"]["Enums"]["appointment_source"]
          start_at: string
          status: Database["public"]["Enums"]["appointment_status"]
          total_amount: number
          updated_at: string
        }
        Insert: {
          barber_id: string
          client_id: string
          created_at?: string
          deposit_amount_cents?: number
          end_at: string
          google_event_id?: string | null
          id?: string
          notes?: string | null
          payment_intent_id?: string | null
          payment_status?: Database["public"]["Enums"]["appointment_payment_status"]
          shop_id: string
          source?: Database["public"]["Enums"]["appointment_source"]
          start_at: string
          status?: Database["public"]["Enums"]["appointment_status"]
          total_amount?: number
          updated_at?: string
        }
        Update: {
          barber_id?: string
          client_id?: string
          created_at?: string
          deposit_amount_cents?: number
          end_at?: string
          google_event_id?: string | null
          id?: string
          notes?: string | null
          payment_intent_id?: string | null
          payment_status?: Database["public"]["Enums"]["appointment_payment_status"]
          shop_id?: string
          source?: Database["public"]["Enums"]["appointment_source"]
          start_at?: string
          status?: Database["public"]["Enums"]["appointment_status"]
          total_amount?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointments_barber_id_fkey"
            columns: ["barber_id"]
            isOneToOne: false
            referencedRelation: "barbers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          actor_id: string | null
          diff: Json | null
          entity: string
          entity_id: string | null
          id: number
          occurred_at: string
          shop_id: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          diff?: Json | null
          entity: string
          entity_id?: string | null
          id?: number
          occurred_at?: string
          shop_id?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          diff?: Json | null
          entity?: string
          entity_id?: string | null
          id?: number
          occurred_at?: string
          shop_id?: string | null
        }
        Relationships: []
      }
      barber_google_calendar: {
        Row: {
          barber_id: string
          calendar_id: string
          created_at: string
          google_email: string
          id: string
          last_error: string | null
          last_synced_at: string | null
          refresh_token_enc: string
          shop_id: string
          sync_status: string
          updated_at: string
        }
        Insert: {
          barber_id: string
          calendar_id?: string
          created_at?: string
          google_email: string
          id?: string
          last_error?: string | null
          last_synced_at?: string | null
          refresh_token_enc: string
          shop_id: string
          sync_status?: string
          updated_at?: string
        }
        Update: {
          barber_id?: string
          calendar_id?: string
          created_at?: string
          google_email?: string
          id?: string
          last_error?: string | null
          last_synced_at?: string | null
          refresh_token_enc?: string
          shop_id?: string
          sync_status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "barber_google_calendar_barber_id_fkey"
            columns: ["barber_id"]
            isOneToOne: true
            referencedRelation: "barbers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "barber_google_calendar_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      barber_settings: {
        Row: {
          allow_booking_wo_payment: boolean
          allow_multiple_services: boolean
          barber_booking_interval_min: number
          barber_id: string | null
          booking_tip: boolean
          client_booking_interval_min: number
          confirmation_tip: boolean
          created_at: string
          customer_cancellations: boolean
          days_book_in_advance: number
          id: string
          mins_book_before_appt: number
          mins_cancel_before_appt: number
          reminder1_h: number
          reminder1_m: number
          reminder2_h: number
          reminder2_m: number
          scope: Database["public"]["Enums"]["barber_settings_scope"]
          shop_id: string
          updated_at: string
        }
        Insert: {
          allow_booking_wo_payment?: boolean
          allow_multiple_services?: boolean
          barber_booking_interval_min?: number
          barber_id?: string | null
          booking_tip?: boolean
          client_booking_interval_min?: number
          confirmation_tip?: boolean
          created_at?: string
          customer_cancellations?: boolean
          days_book_in_advance?: number
          id?: string
          mins_book_before_appt?: number
          mins_cancel_before_appt?: number
          reminder1_h?: number
          reminder1_m?: number
          reminder2_h?: number
          reminder2_m?: number
          scope: Database["public"]["Enums"]["barber_settings_scope"]
          shop_id: string
          updated_at?: string
        }
        Update: {
          allow_booking_wo_payment?: boolean
          allow_multiple_services?: boolean
          barber_booking_interval_min?: number
          barber_id?: string | null
          booking_tip?: boolean
          client_booking_interval_min?: number
          confirmation_tip?: boolean
          created_at?: string
          customer_cancellations?: boolean
          days_book_in_advance?: number
          id?: string
          mins_book_before_appt?: number
          mins_cancel_before_appt?: number
          reminder1_h?: number
          reminder1_m?: number
          reminder2_h?: number
          reminder2_m?: number
          scope?: Database["public"]["Enums"]["barber_settings_scope"]
          shop_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "barber_settings_barber_id_fkey"
            columns: ["barber_id"]
            isOneToOne: false
            referencedRelation: "barbers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "barber_settings_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      barbers: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string
          email: string | null
          id: string
          personnel_id: string | null
          phone: string | null
          shop_id: string
          sort_order: number
          status: Database["public"]["Enums"]["shop_member_status"]
          updated_at: string
          user_id: string | null
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name: string
          email?: string | null
          id?: string
          personnel_id?: string | null
          phone?: string | null
          shop_id: string
          sort_order?: number
          status?: Database["public"]["Enums"]["shop_member_status"]
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string
          email?: string | null
          id?: string
          personnel_id?: string | null
          phone?: string | null
          shop_id?: string
          sort_order?: number
          status?: Database["public"]["Enums"]["shop_member_status"]
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "barbers_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "barbers_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      blocked_time: {
        Row: {
          barber_id: string | null
          created_at: string
          end_at: string
          id: string
          reason: string | null
          shop_id: string
          start_at: string
        }
        Insert: {
          barber_id?: string | null
          created_at?: string
          end_at: string
          id?: string
          reason?: string | null
          shop_id: string
          start_at: string
        }
        Update: {
          barber_id?: string | null
          created_at?: string
          end_at?: string
          id?: string
          reason?: string | null
          shop_id?: string
          start_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "blocked_time_barber_id_fkey"
            columns: ["barber_id"]
            isOneToOne: false
            referencedRelation: "barbers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "blocked_time_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          created_at: string
          email: string | null
          first_name: string
          id: string
          last_name: string | null
          notes: string | null
          phone: string | null
          shop_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          first_name: string
          id?: string
          last_name?: string | null
          notes?: string | null
          phone?: string | null
          shop_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string | null
          first_name?: string
          id?: string
          last_name?: string | null
          notes?: string | null
          phone?: string | null
          shop_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "clients_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      commission_tiers: {
        Row: {
          barber_id: string
          created_at: string
          cumulative: boolean
          id: string
          scope: Database["public"]["Enums"]["commission_scope"]
          shop_id: string
          tier1_pct: number
          tier1_threshold: number
          tier2_pct: number
          tier2_threshold: number
          tier3_pct: number
          tier3_threshold: number
          tier4_pct: number
          tier4_threshold: number
          tier5_pct: number
          tier5_threshold: number
          updated_at: string
        }
        Insert: {
          barber_id: string
          created_at?: string
          cumulative?: boolean
          id?: string
          scope: Database["public"]["Enums"]["commission_scope"]
          shop_id: string
          tier1_pct?: number
          tier1_threshold?: number
          tier2_pct?: number
          tier2_threshold?: number
          tier3_pct?: number
          tier3_threshold?: number
          tier4_pct?: number
          tier4_threshold?: number
          tier5_pct?: number
          tier5_threshold?: number
          updated_at?: string
        }
        Update: {
          barber_id?: string
          created_at?: string
          cumulative?: boolean
          id?: string
          scope?: Database["public"]["Enums"]["commission_scope"]
          shop_id?: string
          tier1_pct?: number
          tier1_threshold?: number
          tier2_pct?: number
          tier2_threshold?: number
          tier3_pct?: number
          tier3_threshold?: number
          tier4_pct?: number
          tier4_threshold?: number
          tier5_pct?: number
          tier5_threshold?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "commission_tiers_barber_id_fkey"
            columns: ["barber_id"]
            isOneToOne: false
            referencedRelation: "barbers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commission_tiers_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      discounts: {
        Row: {
          assignment: Database["public"]["Enums"]["discount_assignment"]
          created_at: string
          id: string
          name: string
          shop_id: string
          type: Database["public"]["Enums"]["discount_type"]
          updated_at: string
          value: number
        }
        Insert: {
          assignment?: Database["public"]["Enums"]["discount_assignment"]
          created_at?: string
          id?: string
          name: string
          shop_id: string
          type: Database["public"]["Enums"]["discount_type"]
          updated_at?: string
          value: number
        }
        Update: {
          assignment?: Database["public"]["Enums"]["discount_assignment"]
          created_at?: string
          id?: string
          name?: string
          shop_id?: string
          type?: Database["public"]["Enums"]["discount_type"]
          updated_at?: string
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "discounts_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      loyalty_program: {
        Row: {
          created_at: string
          enabled: boolean
          goal_count: number
          id: string
          include_product_sales: boolean
          include_tips: boolean
          min_transaction_amount: number
          reward_amount: number
          shop_id: string
          type: Database["public"]["Enums"]["loyalty_type"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          goal_count?: number
          id?: string
          include_product_sales?: boolean
          include_tips?: boolean
          min_transaction_amount?: number
          reward_amount?: number
          shop_id: string
          type?: Database["public"]["Enums"]["loyalty_type"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          enabled?: boolean
          goal_count?: number
          id?: string
          include_product_sales?: boolean
          include_tips?: boolean
          min_transaction_amount?: number
          reward_amount?: number
          shop_id?: string
          type?: Database["public"]["Enums"]["loyalty_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "loyalty_program_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: true
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_automations: {
        Row: {
          channel: string
          created_at: string
          enabled: boolean
          id: string
          kind: string
          shop_id: string
          updated_at: string
        }
        Insert: {
          channel?: string
          created_at?: string
          enabled?: boolean
          id?: string
          kind: string
          shop_id: string
          updated_at?: string
        }
        Update: {
          channel?: string
          created_at?: string
          enabled?: boolean
          id?: string
          kind?: string
          shop_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_automations_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_prefs: {
        Row: {
          created_at: string
          delay_h: number
          delay_m: number
          email: boolean
          event: Database["public"]["Enums"]["notification_event"]
          id: string
          push: boolean
          shop_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          delay_h?: number
          delay_m?: number
          email?: boolean
          event: Database["public"]["Enums"]["notification_event"]
          id?: string
          push?: boolean
          shop_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          delay_h?: number
          delay_m?: number
          email?: boolean
          event?: Database["public"]["Enums"]["notification_event"]
          id?: string
          push?: boolean
          shop_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_prefs_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_sends: {
        Row: {
          appointment_id: string
          id: string
          kind: string
          sent_at: string
          via: string | null
        }
        Insert: {
          appointment_id: string
          id?: string
          kind: string
          sent_at?: string
          via?: string | null
        }
        Update: {
          appointment_id?: string
          id?: string
          kind?: string
          sent_at?: string
          via?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notification_sends_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_profiles: {
        Row: {
          business_type: Database["public"]["Enums"]["business_type"] | null
          created_at: string
          destination_bank_name: string | null
          destination_last4: string | null
          dob: string | null
          id: string
          legal_name: string | null
          shop_id: string
          sin_provided: boolean
          tax_id_provided: boolean
          updated_at: string
          verified: boolean
        }
        Insert: {
          business_type?: Database["public"]["Enums"]["business_type"] | null
          created_at?: string
          destination_bank_name?: string | null
          destination_last4?: string | null
          dob?: string | null
          id?: string
          legal_name?: string | null
          shop_id: string
          sin_provided?: boolean
          tax_id_provided?: boolean
          updated_at?: string
          verified?: boolean
        }
        Update: {
          business_type?: Database["public"]["Enums"]["business_type"] | null
          created_at?: string
          destination_bank_name?: string | null
          destination_last4?: string | null
          dob?: string | null
          id?: string
          legal_name?: string | null
          shop_id?: string
          sin_provided?: boolean
          tax_id_provided?: boolean
          updated_at?: string
          verified?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "payment_profiles_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: true
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      product_brands: {
        Row: {
          created_at: string
          id: string
          name: string
          shop_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          shop_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          shop_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_brands_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      product_categories: {
        Row: {
          created_at: string
          id: string
          name: string
          shop_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          shop_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          shop_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_categories_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      product_taxes: {
        Row: {
          product_id: string
          tax_id: string
        }
        Insert: {
          product_id: string
          tax_id: string
        }
        Update: {
          product_id?: string
          tax_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_taxes_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_taxes_tax_id_fkey"
            columns: ["tax_id"]
            isOneToOne: false
            referencedRelation: "taxes"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          brand_id: string | null
          category_id: string | null
          created_at: string
          current_inventory: number
          id: string
          low_inventory_threshold: number
          name: string
          price: number
          shop_id: string
          sku: string | null
          supply_price: number
          updated_at: string
        }
        Insert: {
          brand_id?: string | null
          category_id?: string | null
          created_at?: string
          current_inventory?: number
          id?: string
          low_inventory_threshold?: number
          name: string
          price: number
          shop_id: string
          sku?: string | null
          supply_price?: number
          updated_at?: string
        }
        Update: {
          brand_id?: string | null
          category_id?: string | null
          created_at?: string
          current_inventory?: number
          id?: string
          low_inventory_threshold?: number
          name?: string
          price?: number
          shop_id?: string
          sku?: string | null
          supply_price?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "products_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "product_brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "product_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string
          full_name: string | null
          id: string
          is_kua_admin: boolean
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email: string
          full_name?: string | null
          id: string
          is_kua_admin?: boolean
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string
          full_name?: string | null
          id?: string
          is_kua_admin?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      promo_codes: {
        Row: {
          code: string
          created_at: string
          expiration_date: string | null
          first_appointment_only: boolean
          id: string
          one_time: boolean
          redemptions: number
          shop_id: string
          total_redemption_value: number
          type: Database["public"]["Enums"]["discount_type"]
          updated_at: string
          value: number
        }
        Insert: {
          code: string
          created_at?: string
          expiration_date?: string | null
          first_appointment_only?: boolean
          id?: string
          one_time?: boolean
          redemptions?: number
          shop_id: string
          total_redemption_value?: number
          type: Database["public"]["Enums"]["discount_type"]
          updated_at?: string
          value: number
        }
        Update: {
          code?: string
          created_at?: string
          expiration_date?: string | null
          first_appointment_only?: boolean
          id?: string
          one_time?: boolean
          redemptions?: number
          shop_id?: string
          total_redemption_value?: number
          type?: Database["public"]["Enums"]["discount_type"]
          updated_at?: string
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "promo_codes_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      service_categories: {
        Row: {
          created_at: string
          id: string
          name: string
          shop_id: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          shop_id: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          shop_id?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_categories_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      service_taxes: {
        Row: {
          service_id: string
          tax_id: string
        }
        Insert: {
          service_id: string
          tax_id: string
        }
        Update: {
          service_id?: string
          tax_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_taxes_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_taxes_tax_id_fkey"
            columns: ["tax_id"]
            isOneToOne: false
            referencedRelation: "taxes"
            referencedColumns: ["id"]
          },
        ]
      }
      services: {
        Row: {
          category_id: string | null
          created_at: string
          deposit_amount_cents: number
          duration_min: number
          id: string
          name: string
          price: number
          shop_id: string
          sort_order: number
          status: Database["public"]["Enums"]["service_status"]
          updated_at: string
        }
        Insert: {
          category_id?: string | null
          created_at?: string
          deposit_amount_cents?: number
          duration_min: number
          id?: string
          name: string
          price: number
          shop_id: string
          sort_order?: number
          status?: Database["public"]["Enums"]["service_status"]
          updated_at?: string
        }
        Update: {
          category_id?: string | null
          created_at?: string
          deposit_amount_cents?: number
          duration_min?: number
          id?: string
          name?: string
          price?: number
          shop_id?: string
          sort_order?: number
          status?: Database["public"]["Enums"]["service_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "services_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "service_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "services_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      shop_days_off: {
        Row: {
          created_at: string
          date: string
          id: string
          reason: string | null
          shop_id: string
        }
        Insert: {
          created_at?: string
          date: string
          id?: string
          reason?: string | null
          shop_id: string
        }
        Update: {
          created_at?: string
          date?: string
          id?: string
          reason?: string | null
          shop_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shop_days_off_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      shop_hours: {
        Row: {
          close_time: string | null
          created_at: string
          enabled: boolean
          id: string
          open_time: string | null
          shop_id: string
          updated_at: string
          weekday: number
        }
        Insert: {
          close_time?: string | null
          created_at?: string
          enabled?: boolean
          id?: string
          open_time?: string | null
          shop_id: string
          updated_at?: string
          weekday: number
        }
        Update: {
          close_time?: string | null
          created_at?: string
          enabled?: boolean
          id?: string
          open_time?: string | null
          shop_id?: string
          updated_at?: string
          weekday?: number
        }
        Relationships: [
          {
            foreignKeyName: "shop_hours_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      shop_members: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["user_role"]
          shop_id: string
          sort_order: number
          status: Database["public"]["Enums"]["shop_member_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["user_role"]
          shop_id: string
          sort_order?: number
          status?: Database["public"]["Enums"]["shop_member_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["user_role"]
          shop_id?: string
          sort_order?: number
          status?: Database["public"]["Enums"]["shop_member_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shop_members_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shop_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      shops: {
        Row: {
          age_21_only: boolean
          alias: string | null
          allow_booking_any_barber: boolean
          client_reviews: boolean
          country: string | null
          created_at: string
          date_format: Database["public"]["Enums"]["date_format_enum"]
          default_cash_drawer_balance: number
          default_language: string
          description: string | null
          email: string | null
          gross_up_fees: boolean
          id: string
          industry: Database["public"]["Enums"]["industry_kind"]
          instagram: string | null
          inventory_alert_email: string | null
          inventory_alert_phone: string | null
          logo_url: string | null
          municipality: string | null
          name: string
          notification_from_email: string | null
          notification_from_name: string | null
          notification_smtp_host: string | null
          notification_smtp_password_enc: string | null
          notification_smtp_port: number | null
          notification_smtp_user: string | null
          payout_discount_mode: Database["public"]["Enums"]["payout_discount_mode"]
          phone: string | null
          postal_code: string | null
          province: string | null
          quickbooks_connect_status: Database["public"]["Enums"]["quickbooks_connect_status"]
          quickbooks_realm_id: string | null
          quickbooks_refresh_token_enc: string | null
          street: string | null
          street2: string | null
          stripe_account_id: string | null
          stripe_connect_status: Database["public"]["Enums"]["stripe_connect_status"]
          supported_languages: string[]
          timezone: string
          updated_at: string
          use_prod_price_in_tips: boolean
          use_taxes_in_tips: boolean
          website: string | null
          widget_config: Json
          yelp_id: string | null
        }
        Insert: {
          age_21_only?: boolean
          alias?: string | null
          allow_booking_any_barber?: boolean
          client_reviews?: boolean
          country?: string | null
          created_at?: string
          date_format?: Database["public"]["Enums"]["date_format_enum"]
          default_cash_drawer_balance?: number
          default_language?: string
          description?: string | null
          email?: string | null
          gross_up_fees?: boolean
          id?: string
          industry?: Database["public"]["Enums"]["industry_kind"]
          instagram?: string | null
          inventory_alert_email?: string | null
          inventory_alert_phone?: string | null
          logo_url?: string | null
          municipality?: string | null
          name: string
          notification_from_email?: string | null
          notification_from_name?: string | null
          notification_smtp_host?: string | null
          notification_smtp_password_enc?: string | null
          notification_smtp_port?: number | null
          notification_smtp_user?: string | null
          payout_discount_mode?: Database["public"]["Enums"]["payout_discount_mode"]
          phone?: string | null
          postal_code?: string | null
          province?: string | null
          quickbooks_connect_status?: Database["public"]["Enums"]["quickbooks_connect_status"]
          quickbooks_realm_id?: string | null
          quickbooks_refresh_token_enc?: string | null
          street?: string | null
          street2?: string | null
          stripe_account_id?: string | null
          stripe_connect_status?: Database["public"]["Enums"]["stripe_connect_status"]
          supported_languages?: string[]
          timezone?: string
          updated_at?: string
          use_prod_price_in_tips?: boolean
          use_taxes_in_tips?: boolean
          website?: string | null
          widget_config?: Json
          yelp_id?: string | null
        }
        Update: {
          age_21_only?: boolean
          alias?: string | null
          allow_booking_any_barber?: boolean
          client_reviews?: boolean
          country?: string | null
          created_at?: string
          date_format?: Database["public"]["Enums"]["date_format_enum"]
          default_cash_drawer_balance?: number
          default_language?: string
          description?: string | null
          email?: string | null
          gross_up_fees?: boolean
          id?: string
          industry?: Database["public"]["Enums"]["industry_kind"]
          instagram?: string | null
          inventory_alert_email?: string | null
          inventory_alert_phone?: string | null
          logo_url?: string | null
          municipality?: string | null
          name?: string
          notification_from_email?: string | null
          notification_from_name?: string | null
          notification_smtp_host?: string | null
          notification_smtp_password_enc?: string | null
          notification_smtp_port?: number | null
          notification_smtp_user?: string | null
          payout_discount_mode?: Database["public"]["Enums"]["payout_discount_mode"]
          phone?: string | null
          postal_code?: string | null
          province?: string | null
          quickbooks_connect_status?: Database["public"]["Enums"]["quickbooks_connect_status"]
          quickbooks_realm_id?: string | null
          quickbooks_refresh_token_enc?: string | null
          street?: string | null
          street2?: string | null
          stripe_account_id?: string | null
          stripe_connect_status?: Database["public"]["Enums"]["stripe_connect_status"]
          supported_languages?: string[]
          timezone?: string
          updated_at?: string
          use_prod_price_in_tips?: boolean
          use_taxes_in_tips?: boolean
          website?: string | null
          widget_config?: Json
          yelp_id?: string | null
        }
        Relationships: []
      }
      taxes: {
        Row: {
          add_to_price: boolean
          created_at: string
          enabled: boolean
          external_orders_only: boolean
          id: string
          name: string
          percentage: number
          shop_id: string
          updated_at: string
        }
        Insert: {
          add_to_price?: boolean
          created_at?: string
          enabled?: boolean
          external_orders_only?: boolean
          id?: string
          name: string
          percentage: number
          shop_id: string
          updated_at?: string
        }
        Update: {
          add_to_price?: boolean
          created_at?: string
          enabled?: boolean
          external_orders_only?: boolean
          id?: string
          name?: string
          percentage?: number
          shop_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "taxes_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      tips_config: {
        Row: {
          booking_tip: boolean
          confirmation_tip: boolean
          created_at: string
          flat_tier1: number
          flat_tier2: number
          flat_tier3: number
          flat_tier4: number
          id: string
          pct_tier1: number
          pct_tier2: number
          pct_tier3: number
          pct_tier4: number
          pct_use_above_amount: number
          round_up: boolean
          shop_id: string
          updated_at: string
        }
        Insert: {
          booking_tip?: boolean
          confirmation_tip?: boolean
          created_at?: string
          flat_tier1?: number
          flat_tier2?: number
          flat_tier3?: number
          flat_tier4?: number
          id?: string
          pct_tier1?: number
          pct_tier2?: number
          pct_tier3?: number
          pct_tier4?: number
          pct_use_above_amount?: number
          round_up?: boolean
          shop_id: string
          updated_at?: string
        }
        Update: {
          booking_tip?: boolean
          confirmation_tip?: boolean
          created_at?: string
          flat_tier1?: number
          flat_tier2?: number
          flat_tier3?: number
          flat_tier4?: number
          id?: string
          pct_tier1?: number
          pct_tier2?: number
          pct_tier3?: number
          pct_tier4?: number
          pct_use_above_amount?: number
          round_up?: boolean
          shop_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tips_config_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: true
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      waiting_list_config: {
        Row: {
          created_at: string
          enabled: boolean
          id: string
          shop_id: string
          threshold_hours: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          id?: string
          shop_id: string
          threshold_hours?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          enabled?: boolean
          id?: string
          shop_id?: string
          threshold_hours?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "waiting_list_config_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: true
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      current_shop_ids: { Args: never; Returns: string[] }
      has_role_in_shop: {
        Args: {
          target_role: Database["public"]["Enums"]["user_role"]
          target_shop_id: string
        }
        Returns: boolean
      }
      is_shop_member: { Args: { target_shop_id: string }; Returns: boolean }
    }
    Enums: {
      appointment_payment_status:
        | "unpaid"
        | "pending"
        | "paid"
        | "refunded"
        | "failed"
      appointment_source: "admin" | "online"
      appointment_status:
        | "booked"
        | "confirmed"
        | "arrived"
        | "completed"
        | "cancelled"
        | "no_show"
      barber_settings_scope: "shop" | "barber"
      business_type: "individual" | "company"
      commission_scope: "services" | "products"
      date_format_enum: "USA" | "EU"
      discount_assignment: "services_only" | "products_only" | "both"
      discount_type: "percent" | "fixed"
      industry_kind:
        | "hair_salon"
        | "barbershop"
        | "massage"
        | "physio"
        | "chiropractic"
        | "esthetics"
      loyalty_type: "transaction" | "value"
      notification_event:
        | "confirm"
        | "reschedule"
        | "cancel"
        | "arrived"
        | "reminder"
        | "client_reminder_1"
        | "client_reminder_2"
      payout_discount_mode: "split" | "shop" | "barber"
      quickbooks_connect_status:
        | "not_started"
        | "active"
        | "expired"
        | "disconnected"
      service_status: "enabled" | "disabled"
      shop_member_status: "confirmed" | "staff" | "deleted"
      stripe_connect_status: "not_started" | "pending" | "restricted" | "active"
      user_role: "owner" | "manager" | "barber"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      appointment_payment_status: [
        "unpaid",
        "pending",
        "paid",
        "refunded",
        "failed",
      ],
      appointment_source: ["admin", "online"],
      appointment_status: [
        "booked",
        "confirmed",
        "arrived",
        "completed",
        "cancelled",
        "no_show",
      ],
      barber_settings_scope: ["shop", "barber"],
      business_type: ["individual", "company"],
      commission_scope: ["services", "products"],
      date_format_enum: ["USA", "EU"],
      discount_assignment: ["services_only", "products_only", "both"],
      discount_type: ["percent", "fixed"],
      industry_kind: [
        "hair_salon",
        "barbershop",
        "massage",
        "physio",
        "chiropractic",
        "esthetics",
      ],
      loyalty_type: ["transaction", "value"],
      notification_event: [
        "confirm",
        "reschedule",
        "cancel",
        "arrived",
        "reminder",
        "client_reminder_1",
        "client_reminder_2",
      ],
      payout_discount_mode: ["split", "shop", "barber"],
      quickbooks_connect_status: [
        "not_started",
        "active",
        "expired",
        "disconnected",
      ],
      service_status: ["enabled", "disabled"],
      shop_member_status: ["confirmed", "staff", "deleted"],
      stripe_connect_status: ["not_started", "pending", "restricted", "active"],
      user_role: ["owner", "manager", "barber"],
    },
  },
} as const
