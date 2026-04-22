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
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      client_activity_log: {
        Row: {
          action_type: string
          client_id: string
          created_at: string
          description: string
          id: string
          metadata: Json | null
          user_id: string
        }
        Insert: {
          action_type: string
          client_id: string
          created_at?: string
          description: string
          id?: string
          metadata?: Json | null
          user_id: string
        }
        Update: {
          action_type?: string
          client_id?: string
          created_at?: string
          description?: string
          id?: string
          metadata?: Json | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_activity_log_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      client_events: {
        Row: {
          client_id: string
          created_at: string
          event_date: string
          event_type: string
          google_event_id: string | null
          id: string
          notes: string | null
          recurrence: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          client_id: string
          created_at?: string
          event_date: string
          event_type?: string
          google_event_id?: string | null
          id?: string
          notes?: string | null
          recurrence?: string
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          client_id?: string
          created_at?: string
          event_date?: string
          event_type?: string
          google_event_id?: string | null
          id?: string
          notes?: string | null
          recurrence?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_events_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      client_notes: {
        Row: {
          client_id: string
          content: string
          created_at: string
          id: string
          is_action: boolean
          is_done: boolean
          user_id: string
        }
        Insert: {
          client_id: string
          content: string
          created_at?: string
          id?: string
          is_action?: boolean
          is_done?: boolean
          user_id: string
        }
        Update: {
          client_id?: string
          content?: string
          created_at?: string
          id?: string
          is_action?: boolean
          is_done?: boolean
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_notes_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      client_properties: {
        Row: {
          client_id: string
          created_at: string
          id: string
          notes: string | null
          property_id: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          client_id: string
          created_at?: string
          id?: string
          notes?: string | null
          property_id: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          client_id?: string
          created_at?: string
          id?: string
          notes?: string | null
          property_id?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_properties_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_properties_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      client_tags: {
        Row: {
          client_id: string
          created_at: string
          id: string
          tag_id: string
        }
        Insert: {
          client_id: string
          created_at?: string
          id?: string
          tag_id: string
        }
        Update: {
          client_id?: string
          created_at?: string
          id?: string
          tag_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_tags_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_tags_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "tags"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          address: string | null
          birthday: string | null
          budget_currency: string | null
          budget_max: number | null
          budget_min: number | null
          client_type: string
          company: string | null
          created_at: string
          email: string | null
          full_name: string
          id: string
          last_contact_at: string | null
          notes: string | null
          phone: string | null
          preferred_zones: string | null
          property_type_interest: string | null
          source: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          address?: string | null
          birthday?: string | null
          budget_currency?: string | null
          budget_max?: number | null
          budget_min?: number | null
          client_type?: string
          company?: string | null
          created_at?: string
          email?: string | null
          full_name: string
          id?: string
          last_contact_at?: string | null
          notes?: string | null
          phone?: string | null
          preferred_zones?: string | null
          property_type_interest?: string | null
          source?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          address?: string | null
          birthday?: string | null
          budget_currency?: string | null
          budget_max?: number | null
          budget_min?: number | null
          client_type?: string
          company?: string | null
          created_at?: string
          email?: string | null
          full_name?: string
          id?: string
          last_contact_at?: string | null
          notes?: string | null
          phone?: string | null
          preferred_zones?: string | null
          property_type_interest?: string | null
          source?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      conversations: {
        Row: {
          client_id: string | null
          conversation_type: string | null
          created_at: string
          id: string
          last_read_at: string | null
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          client_id?: string | null
          conversation_type?: string | null
          created_at?: string
          id?: string
          last_read_at?: string | null
          title?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          client_id?: string | null
          conversation_type?: string | null
          created_at?: string
          id?: string
          last_read_at?: string | null
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversations_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      favorites: {
        Row: {
          created_at: string
          id: string
          property_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          property_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          property_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "favorites_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      google_calendar_tokens: {
        Row: {
          access_token: string
          created_at: string
          expires_at: string
          id: string
          refresh_token: string
          scope: string | null
          token_type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          access_token: string
          created_at?: string
          expires_at: string
          id?: string
          refresh_token: string
          scope?: string | null
          token_type?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          access_token?: string
          created_at?: string
          expires_at?: string
          id?: string
          refresh_token?: string
          scope?: string | null
          token_type?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      invitation_attempts: {
        Row: {
          created_at: string
          id: string
          normalized_input: string
          raw_bytes: string
          raw_input: string
          status: string
          user_agent: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          normalized_input: string
          raw_bytes: string
          raw_input: string
          status: string
          user_agent?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          normalized_input?: string
          raw_bytes?: string
          raw_input?: string
          status?: string
          user_agent?: string | null
        }
        Relationships: []
      }
      invitation_codes: {
        Row: {
          code: string
          created_at: string
          id: string
          is_active: boolean
        }
        Insert: {
          code: string
          created_at?: string
          id?: string
          is_active?: boolean
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          is_active?: boolean
        }
        Relationships: []
      }
      messages: {
        Row: {
          content: string
          conversation_id: string
          created_at: string
          id: string
          role: string
        }
        Insert: {
          content: string
          conversation_id: string
          created_at?: string
          id?: string
          role: string
        }
        Update: {
          content?: string
          conversation_id?: string
          created_at?: string
          id?: string
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      notified_matches: {
        Row: {
          client_id: string
          created_at: string
          id: string
          property_id: string
          user_id: string
        }
        Insert: {
          client_id: string
          created_at?: string
          id?: string
          property_id: string
          user_id: string
        }
        Update: {
          client_id?: string
          created_at?: string
          id?: string
          property_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notified_matches_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notified_matches_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          agent_code: string
          created_at: string
          full_name: string
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          agent_code: string
          created_at?: string
          full_name: string
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          agent_code?: string
          created_at?: string
          full_name?: string
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      properties: {
        Row: {
          address: string | null
          ambientes: number | null
          banos: number | null
          brokers: string | null
          contact_person: string | null
          created_at: string
          currency: string | null
          dimensions_land_m2: number | null
          external_id: string | null
          id: string
          last_seen_at: string | null
          lat: number | null
          lng: number | null
          locality: string | null
          m2_cover: number | null
          m2_total: number | null
          office: string | null
          operation: string | null
          photo: string | null
          price: number | null
          property_type: string | null
          title: string | null
          updated_at: string
          url: string | null
          zone: string | null
        }
        Insert: {
          address?: string | null
          ambientes?: number | null
          banos?: number | null
          brokers?: string | null
          contact_person?: string | null
          created_at?: string
          currency?: string | null
          dimensions_land_m2?: number | null
          external_id?: string | null
          id?: string
          last_seen_at?: string | null
          lat?: number | null
          lng?: number | null
          locality?: string | null
          m2_cover?: number | null
          m2_total?: number | null
          office?: string | null
          operation?: string | null
          photo?: string | null
          price?: number | null
          property_type?: string | null
          title?: string | null
          updated_at?: string
          url?: string | null
          zone?: string | null
        }
        Update: {
          address?: string | null
          ambientes?: number | null
          banos?: number | null
          brokers?: string | null
          contact_person?: string | null
          created_at?: string
          currency?: string | null
          dimensions_land_m2?: number | null
          external_id?: string | null
          id?: string
          last_seen_at?: string | null
          lat?: number | null
          lng?: number | null
          locality?: string | null
          m2_cover?: number | null
          m2_total?: number | null
          office?: string | null
          operation?: string | null
          photo?: string | null
          price?: number | null
          property_type?: string | null
          title?: string | null
          updated_at?: string
          url?: string | null
          zone?: string | null
        }
        Relationships: []
      }
      push_delivery_logs: {
        Row: {
          created_at: string
          endpoint_preview: string
          error_message: string | null
          http_status: number | null
          id: string
          pruned: boolean
          status: string
          trigger_source: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          endpoint_preview: string
          error_message?: string | null
          http_status?: number | null
          id?: string
          pruned?: boolean
          status: string
          trigger_source?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          endpoint_preview?: string
          error_message?: string | null
          http_status?: number | null
          id?: string
          pruned?: boolean
          status?: string
          trigger_source?: string | null
          user_id?: string
        }
        Relationships: []
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          device_label: string | null
          endpoint: string
          id: string
          is_standalone: boolean | null
          last_seen_at: string
          p256dh: string
          platform: string | null
          user_agent: string | null
          user_id: string
        }
        Insert: {
          auth: string
          created_at?: string
          device_label?: string | null
          endpoint: string
          id?: string
          is_standalone?: boolean | null
          last_seen_at?: string
          p256dh: string
          platform?: string | null
          user_agent?: string | null
          user_id: string
        }
        Update: {
          auth?: string
          created_at?: string
          device_label?: string | null
          endpoint?: string
          id?: string
          is_standalone?: boolean | null
          last_seen_at?: string
          p256dh?: string
          platform?: string | null
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      scraping_logs: {
        Row: {
          batch_id: string
          created_at: string
          current_page: number | null
          id: string
          level: string
          message: string
          properties_count: number | null
          total_pages: number | null
        }
        Insert: {
          batch_id: string
          created_at?: string
          current_page?: number | null
          id?: string
          level?: string
          message: string
          properties_count?: number | null
          total_pages?: number | null
        }
        Update: {
          batch_id?: string
          created_at?: string
          current_page?: number | null
          id?: string
          level?: string
          message?: string
          properties_count?: number | null
          total_pages?: number | null
        }
        Relationships: []
      }
      supervisor_logs: {
        Row: {
          alan_response: string
          conversation_id: string | null
          created_at: string | null
          id: string
          latency_ms: number | null
          rejection_reason: string | null
          retry_count: number | null
          score: number | null
          user_id: string | null
          user_message: string
          verdict: string
        }
        Insert: {
          alan_response: string
          conversation_id?: string | null
          created_at?: string | null
          id?: string
          latency_ms?: number | null
          rejection_reason?: string | null
          retry_count?: number | null
          score?: number | null
          user_id?: string | null
          user_message: string
          verdict: string
        }
        Update: {
          alan_response?: string
          conversation_id?: string | null
          created_at?: string | null
          id?: string
          latency_ms?: number | null
          rejection_reason?: string | null
          retry_count?: number | null
          score?: number | null
          user_id?: string | null
          user_message?: string
          verdict?: string
        }
        Relationships: []
      }
      tags: {
        Row: {
          color: string
          created_at: string
          id: string
          name: string
          user_id: string
        }
        Insert: {
          color?: string
          created_at?: string
          id?: string
          name: string
          user_id: string
        }
        Update: {
          color?: string
          created_at?: string
          id?: string
          name?: string
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      cleanup_old_logs: { Args: never; Returns: undefined }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_conversation_owner: { Args: { conv_id: string }; Returns: boolean }
      search_properties_filtered: {
        Args: {
          op_filter?: string
          page_offset?: number
          page_size?: number
          price_max?: number
          price_min?: number
          search_term?: string
          type_filter?: string
        }
        Returns: {
          address: string
          ambientes: number
          banos: number
          created_at: string
          currency: string
          id: string
          locality: string
          m2_cover: number
          m2_total: number
          office: string
          operation: string
          photo: string
          price: number
          property_type: string
          title: string
          total_count: number
          url: string
          zone: string
        }[]
      }
      validate_invitation_code: {
        Args: { input_code: string }
        Returns: boolean
      }
      validate_invitation_code_v2: {
        Args: { input_code: string }
        Returns: string
      }
    }
    Enums: {
      app_role: "super_admin" | "user"
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
      app_role: ["super_admin", "user"],
    },
  },
} as const
