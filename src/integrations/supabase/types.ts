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
      api_keys: {
        Row: {
          created_at: string
          id: string
          key_hash: string
          key_prefix: string
          last_used_at: string | null
          name: string
          revoked_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          key_hash: string
          key_prefix: string
          last_used_at?: string | null
          name: string
          revoked_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          key_hash?: string
          key_prefix?: string
          last_used_at?: string | null
          name?: string
          revoked_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      app_secrets: {
        Row: {
          created_at: string
          name: string
          value: string
        }
        Insert: {
          created_at?: string
          name: string
          value: string
        }
        Update: {
          created_at?: string
          name?: string
          value?: string
        }
        Relationships: []
      }
      automation_logs: {
        Row: {
          automation_id: string | null
          comment_text: string | null
          created_at: string
          error: string | null
          id: string
          instagram_post_id: string | null
          instagram_user: string | null
          message_sent: string | null
          status: string
          user_id: string
        }
        Insert: {
          automation_id?: string | null
          comment_text?: string | null
          created_at?: string
          error?: string | null
          id?: string
          instagram_post_id?: string | null
          instagram_user?: string | null
          message_sent?: string | null
          status?: string
          user_id: string
        }
        Update: {
          automation_id?: string | null
          comment_text?: string | null
          created_at?: string
          error?: string | null
          id?: string
          instagram_post_id?: string | null
          instagram_user?: string | null
          message_sent?: string | null
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "automation_logs_automation_id_fkey"
            columns: ["automation_id"]
            isOneToOne: false
            referencedRelation: "automations"
            referencedColumns: ["id"]
          },
        ]
      }
      automations: {
        Row: {
          buttons: Json
          created_at: string
          custom_message: string
          delay_max_seconds: number
          delay_min_seconds: number
          follower_gate_message: string | null
          followup_message: string
          id: string
          instagram_post_id: string
          instagram_post_type: string
          is_active: boolean
          keyword_filter_enabled: boolean
          keywords: string[]
          name: string
          quick_replies: Json
          require_follow: boolean
          total_clicks: number
          total_failed: number
          total_sent: number
          trigger_on_dm: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          buttons?: Json
          created_at?: string
          custom_message?: string
          delay_max_seconds?: number
          delay_min_seconds?: number
          follower_gate_message?: string | null
          followup_message?: string
          id?: string
          instagram_post_id: string
          instagram_post_type?: string
          is_active?: boolean
          keyword_filter_enabled?: boolean
          keywords?: string[]
          name: string
          quick_replies?: Json
          require_follow?: boolean
          total_clicks?: number
          total_failed?: number
          total_sent?: number
          trigger_on_dm?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          buttons?: Json
          created_at?: string
          custom_message?: string
          delay_max_seconds?: number
          delay_min_seconds?: number
          follower_gate_message?: string | null
          followup_message?: string
          id?: string
          instagram_post_id?: string
          instagram_post_type?: string
          is_active?: boolean
          keyword_filter_enabled?: boolean
          keywords?: string[]
          name?: string
          quick_replies?: Json
          require_follow?: boolean
          total_clicks?: number
          total_failed?: number
          total_sent?: number
          trigger_on_dm?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      flow_sessions: {
        Row: {
          context: Json
          conversation_id: string
          current_node_id: string
          flow_id: string
          started_at: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          context?: Json
          conversation_id: string
          current_node_id: string
          flow_id: string
          started_at?: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          context?: Json
          conversation_id?: string
          current_node_id?: string
          flow_id?: string
          started_at?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "flow_sessions_flow_id_fkey"
            columns: ["flow_id"]
            isOneToOne: false
            referencedRelation: "flows"
            referencedColumns: ["id"]
          },
        ]
      }
      flows: {
        Row: {
          created_at: string
          edges: Json
          follower_gate_message: string | null
          id: string
          instagram_post_id: string | null
          instagram_post_type: string
          is_active: boolean
          keyword_filter_enabled: boolean
          keywords: string[]
          name: string
          nodes: Json
          require_follow: boolean
          total_clicks: number
          total_failed: number
          total_sent: number
          tree: Json | null
          trigger_type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          edges?: Json
          follower_gate_message?: string | null
          id?: string
          instagram_post_id?: string | null
          instagram_post_type?: string
          is_active?: boolean
          keyword_filter_enabled?: boolean
          keywords?: string[]
          name: string
          nodes?: Json
          require_follow?: boolean
          total_clicks?: number
          total_failed?: number
          total_sent?: number
          tree?: Json | null
          trigger_type?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          edges?: Json
          follower_gate_message?: string | null
          id?: string
          instagram_post_id?: string | null
          instagram_post_type?: string
          is_active?: boolean
          keyword_filter_enabled?: boolean
          keywords?: string[]
          name?: string
          nodes?: Json
          require_follow?: boolean
          total_clicks?: number
          total_failed?: number
          total_sent?: number
          tree?: Json | null
          trigger_type?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          email: string
          id: string
          name: string | null
          updated_at: string
          webhook_token: string
        }
        Insert: {
          created_at?: string
          email: string
          id: string
          name?: string | null
          updated_at?: string
          webhook_token?: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          name?: string | null
          updated_at?: string
          webhook_token?: string
        }
        Relationships: []
      }
      user_settings: {
        Row: {
          created_at: string
          instagram_connected: boolean
          instagram_username: string | null
          origin_is_manual: boolean
          outgoing_webhook_enabled: boolean
          outgoing_webhook_url: string | null
          published_origin: string | null
          updated_at: string
          user_id: string
          zernio_account_id: string | null
          zernio_api_key_encrypted: string | null
        }
        Insert: {
          created_at?: string
          instagram_connected?: boolean
          instagram_username?: string | null
          origin_is_manual?: boolean
          outgoing_webhook_enabled?: boolean
          outgoing_webhook_url?: string | null
          published_origin?: string | null
          updated_at?: string
          user_id: string
          zernio_account_id?: string | null
          zernio_api_key_encrypted?: string | null
        }
        Update: {
          created_at?: string
          instagram_connected?: boolean
          instagram_username?: string | null
          origin_is_manual?: boolean
          outgoing_webhook_enabled?: boolean
          outgoing_webhook_url?: string | null
          published_origin?: string | null
          updated_at?: string
          user_id?: string
          zernio_account_id?: string | null
          zernio_api_key_encrypted?: string | null
        }
        Relationships: []
      }
      webhook_events: {
        Row: {
          created_at: string
          event_id: string
          processed_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          event_id: string
          processed_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          event_id?: string
          processed_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      ensure_profile: { Args: never; Returns: string }
      ensure_user_provisioned: { Args: never; Returns: string }
      increment_automation_counters: {
        Args: { aid: string; failed_delta: number; sent_delta: number }
        Returns: undefined
      }
      increment_flow_counters: {
        Args: { failed_delta: number; fid: string; sent_delta: number }
        Returns: undefined
      }
      register_automation_click: { Args: { aid: string }; Returns: undefined }
      register_flow_click: { Args: { fid: string }; Returns: undefined }
    }
    Enums: {
      [_ in never]: never
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
