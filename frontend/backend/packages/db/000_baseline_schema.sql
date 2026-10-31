--
-- GoldPlay :: baseline schema seed for database "goldplay1"
--
-- Structure only: every table, column, default, sequence, primary key,
-- unique/check/foreign-key constraint, index and view. No rows.
--
-- Source     : PostgreSQL 14.22, schema "public"
-- Generated  : 2026-07-30 (pg_dump --schema-only --no-owner --no-privileges)
--
-- Restore into an empty database:
--   createdb -h 127.0.0.1 -U goldplay1 goldplay1
--   psql -h 127.0.0.1 -U goldplay1 -d goldplay1 -f 000_baseline_schema.sql
--
-- Run this before any of the incremental migrations in this directory.
--

--
-- PostgreSQL database dump
--


-- Dumped from database version 14.22 (Ubuntu 14.22-0ubuntu0.22.04.1)
-- Dumped by pg_dump version 14.22 (Ubuntu 14.22-0ubuntu0.22.04.1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA IF NOT EXISTS public;


--
-- Name: SportsBet_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."SportsBet_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: SportsBet; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."SportsBet" (
    id integer DEFAULT nextval('public."SportsBet_id_seq"'::regclass) NOT NULL,
    user_id bigint,
    game_type character varying(100),
    match_title character varying(255),
    team_one character varying(255),
    team_two character varying(255),
    selection_name character varying(255),
    category character varying(100),
    bet_type character varying(100),
    market_type character varying(100),
    odds numeric(10,4),
    stake_amount numeric(15,2),
    original_currency character varying(10) DEFAULT 'INR'::character varying,
    original_amount numeric(15,2),
    usd_amount numeric(15,2),
    liability numeric(15,2),
    match_start_time timestamp with time zone,
    match_end_time timestamp with time zone,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    match_id character varying(100),
    exposure_after_bet numeric(15,2),
    status character varying(20),
    eventid text,
    job_id uuid,
    ip_address text,
    fancy_name text,
    result_status text DEFAULT 'pending'::text,
    fixed integer DEFAULT 0,
    counts integer DEFAULT 2,
    sport_id text,
    unmatched boolean DEFAULT false,
    unmatched_odds numeric(10,4),
    runners jsonb,
    size integer,
    event_name character varying(255),
    lay_size numeric,
    back_size numeric
);


--
-- Name: admin_activity_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admin_activity_logs (
    id bigint NOT NULL,
    staff_id integer NOT NULL,
    executive_id integer,
    actor_name character varying(120),
    actor_role character varying(50),
    actor_level integer,
    action character varying(80) NOT NULL,
    target_type character varying(40),
    target_id character varying(60),
    details jsonb,
    ip character varying(64),
    country character varying(80),
    region character varying(80),
    city character varying(120),
    user_agent character varying(512),
    status character varying(10) DEFAULT 'success'::character varying NOT NULL,
    error_message character varying(512),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT admin_activity_logs_status_check CHECK (((status)::text = ANY ((ARRAY['success'::character varying, 'failed'::character varying])::text[])))
);


--
-- Name: admin_activity_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.admin_activity_logs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: admin_activity_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.admin_activity_logs_id_seq OWNED BY public.admin_activity_logs.id;


--
-- Name: admin_configurations_config_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.admin_configurations_config_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    MAXVALUE 2147483647
    CACHE 1;


--
-- Name: admin_configurations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admin_configurations (
    config_id integer DEFAULT nextval('public.admin_configurations_config_id_seq'::regclass) NOT NULL,
    config_key character varying(100) NOT NULL,
    config_value character varying(255) NOT NULL,
    last_updated timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: apaydeposits_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.apaydeposits_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    MAXVALUE 2147483647
    CACHE 1;


--
-- Name: apaydeposits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.apaydeposits (
    id integer DEFAULT nextval('public.apaydeposits_id_seq'::regclass) NOT NULL,
    order_id character varying(50) NOT NULL,
    user_id bigint NOT NULL,
    amount numeric(18,2) NOT NULL,
    currency character varying(10) NOT NULL,
    payment_system character varying(50) NOT NULL,
    custom_transaction_id character varying(200),
    status character varying(20) DEFAULT 'Pending'::character varying,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    payment_details jsonb,
    webhook_response jsonb,
    error_reason text
);


--
-- Name: apaywithdrawals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.apaywithdrawals (
    id bigint NOT NULL,
    order_id character varying(100) NOT NULL,
    user_id character varying(200) NOT NULL,
    amount numeric(20,2) NOT NULL,
    currency character varying(10) NOT NULL,
    payment_system character varying(50) NOT NULL,
    custom_transaction_id character varying(200),
    status character varying(30) DEFAULT 'Pending'::character varying NOT NULL,
    payout_details jsonb,
    payment_details jsonb,
    webhook_response jsonb,
    error_reason text,
    refunded boolean DEFAULT false NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: apaywithdrawals_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.apaywithdrawals_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: apaywithdrawals_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.apaywithdrawals_id_seq OWNED BY public.apaywithdrawals.id;


--
-- Name: apigames; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.apigames (
    id bigint,
    title text,
    platform text,
    type text,
    subtype text,
    enabled bigint,
    fun_mode bigint,
    campaigns bigint,
    vendor text,
    created_at text,
    vendor_groups text,
    details_description_en text,
    details_thumbnails_300x300 text
);


--
-- Name: bank; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bank (
    btc numeric DEFAULT '0'::numeric,
    eth numeric DEFAULT '0'::numeric,
    ltc numeric DEFAULT '0'::numeric,
    bch numeric DEFAULT '0'::numeric,
    usdt numeric DEFAULT '0'::numeric,
    trx numeric DEFAULT '0'::numeric,
    doge numeric DEFAULT '0'::numeric,
    ada numeric DEFAULT '0'::numeric,
    xrp numeric DEFAULT '0'::numeric,
    bnb numeric DEFAULT '0'::numeric,
    usdp numeric DEFAULT '0'::numeric,
    nexo numeric DEFAULT '0'::numeric,
    mkr numeric DEFAULT '0'::numeric,
    tusd numeric DEFAULT '0'::numeric,
    usdc numeric DEFAULT '0'::numeric,
    busd numeric DEFAULT '0'::numeric,
    id bigint NOT NULL,
    inr numeric DEFAULT '0'::numeric,
    sc numeric DEFAULT '0'::numeric,
    mvr numeric DEFAULT '0'::numeric,
    bjb numeric DEFAULT '0'::numeric,
    aed numeric DEFAULT '0'::numeric,
    npr numeric DEFAULT '0'::numeric,
    pkr numeric DEFAULT '0'::numeric
);


--
-- Name: banners_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.banners_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    MAXVALUE 2147483647
    CACHE 1;


--
-- Name: banners; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.banners (
    id integer DEFAULT nextval('public.banners_id_seq'::regclass) NOT NULL,
    type character varying(100) NOT NULL,
    image character varying(255),
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: betoutcome_1m; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.betoutcome_1m (
    sessionid character varying(250),
    betnumber integer,
    betcolour character varying(250)
);


--
-- Name: betoutcome_2m; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.betoutcome_2m (
    sessionid character varying(250),
    betnumber integer,
    betcolour character varying(250)
);


--
-- Name: betoutcome_30s; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.betoutcome_30s (
    sessionid character varying(250),
    betnumber integer,
    betcolour character varying(250)
);


--
-- Name: bets_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.bets_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: bets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bets (
    game text NOT NULL,
    gid bigint NOT NULL,
    uid bigint NOT NULL,
    amount numeric NOT NULL,
    coin text NOT NULL,
    result json,
    profit numeric DEFAULT '0'::numeric,
    created timestamp with time zone,
    hash text,
    name text,
    cashout numeric,
    slot character varying(255),
    id bigint DEFAULT nextval('public.bets_id_seq'::regclass) NOT NULL
);


--
-- Name: bets_1m; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bets_1m (
    uid character varying(250),
    value character varying(250),
    amount character varying(250),
    sessionid character varying(250),
    status character varying(250),
    cointype character varying(50)
);


--
-- Name: bets_2m; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bets_2m (
    uid character varying(250),
    value character varying(250),
    amount character varying(250),
    sessionid character varying(250),
    status character varying(250),
    cointype character varying(50)
);


--
-- Name: bets_30s; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bets_30s (
    uid character varying(250),
    value character varying(250),
    amount character varying(250),
    sessionid character varying(250),
    status character varying(250),
    cointype character varying(50)
);


--
-- Name: blogs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.blogs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    MAXVALUE 2147483647
    CACHE 1;


--
-- Name: blogs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.blogs (
    id integer DEFAULT nextval('public.blogs_id_seq'::regclass) NOT NULL,
    slug character varying(255) NOT NULL,
    title character varying(512) NOT NULL,
    subheading text,
    description text NOT NULL,
    author character varying(255) DEFAULT 'Anonymous'::character varying,
    date timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    category character varying(128) DEFAULT 'Uncategorized'::character varying,
    image text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: bonus_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bonus_history (
    id bigint NOT NULL,
    userid bigint NOT NULL,
    bonus_type text NOT NULL,
    bonus_amount numeric(20,8) DEFAULT 0 NOT NULL,
    wager_change numeric(20,8) DEFAULT 0 NOT NULL,
    claim_deadline timestamp with time zone NOT NULL,
    is_claimed boolean DEFAULT false NOT NULL,
    is_unclaimable boolean DEFAULT false NOT NULL,
    claimed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: bonus_history_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.bonus_history_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: bonus_history_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.bonus_history_id_seq OWNED BY public.bonus_history.id;


--
-- Name: bonus_history_id_seq1; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.bonus_history_id_seq1
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: bonusgame; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bonusgame (
    userid bigint NOT NULL,
    luckyspin numeric NOT NULL,
    dailybonus numeric NOT NULL,
    weeklybonus numeric NOT NULL,
    monthlybonus numeric NOT NULL,
    depositbonus numeric NOT NULL,
    rollcompetitionbonus numeric NOT NULL,
    createdat timestamp without time zone NOT NULL,
    updatedat timestamp without time zone NOT NULL,
    rakebackbonus numeric
);


--
-- Name: bonushistory; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bonushistory (
    userid bigint NOT NULL,
    event text NOT NULL,
    amount integer NOT NULL,
    createdat timestamp without time zone NOT NULL,
    updatedat timestamp without time zone NOT NULL
);


--
-- Name: bots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bots (
    id numeric NOT NULL,
    status text,
    "time" numeric,
    game text,
    coin text
);


--
-- Name: ccdeposit_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ccdeposit_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    MAXVALUE 2147483647
    CACHE 1;


--
-- Name: ccdeposit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ccdeposit (
    id integer DEFAULT nextval('public.ccdeposit_id_seq'::regclass) NOT NULL,
    userid character varying(255),
    coinid integer,
    price numeric(10,2),
    orderid character varying(255),
    chain character varying(10),
    deposit_address character varying(255),
    amount numeric(10,2),
    memo character varying(255),
    checkout_url character varying(255),
    confirms_needed integer,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone,
    status text NOT NULL
);


--
-- Name: chat_brazil; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chat_brazil (
    name text NOT NULL,
    message text NOT NULL,
    sorter numeric NOT NULL,
    date timestamp with time zone DEFAULT now(),
    avatar text,
    uid bigint NOT NULL,
    "time" text,
    level numeric DEFAULT '1'::numeric
);


--
-- Name: chat_global; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chat_global (
    name text NOT NULL,
    message text NOT NULL,
    sorter numeric NOT NULL,
    date timestamp with time zone DEFAULT now(),
    avatar text,
    uid bigint NOT NULL,
    "time" text,
    level bigint DEFAULT '1'::bigint
);


--
-- Name: club_banners_id_seq1; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.club_banners_id_seq1
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: club_earnings_configurations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.club_earnings_configurations_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: club_earnings_configurations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.club_earnings_configurations (
    id bigint DEFAULT nextval('public.club_earnings_configurations_id_seq'::regclass) NOT NULL,
    club_id bigint NOT NULL,
    configuration_type character varying(50) NOT NULL,
    owner_percentage numeric(5,2) DEFAULT 10.0,
    agent_percentage numeric(5,2) DEFAULT 20.0,
    member_percentage numeric(5,2) DEFAULT 5.0,
    active_player_threshold integer DEFAULT 5,
    wager_threshold numeric(10,2) DEFAULT 200.0,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: club_hierarchy; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.club_hierarchy (
    ancestor_id bigint NOT NULL,
    descendant_id bigint NOT NULL,
    depth integer DEFAULT 0
);


--
-- Name: club_memberships_id_seq1; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.club_memberships_id_seq1
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: club_notifications_id_seq1; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.club_notifications_id_seq1
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: clubs_id_seq1; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.clubs_id_seq1
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: clubs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.clubs (
    id bigint DEFAULT nextval('public.clubs_id_seq1'::regclass) NOT NULL,
    name text NOT NULL,
    owner_id bigint NOT NULL,
    description text,
    avatar text,
    max_members integer DEFAULT 50,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    unique_club_id character varying(50),
    profile_picture text,
    owner_earnings_percentage numeric(5,2) DEFAULT 10.0,
    agent_earnings_percentage numeric(5,2) DEFAULT 20.0,
    min_active_players_threshold integer DEFAULT 5,
    active_player_wager_threshold numeric(10,2) DEFAULT 200.0,
    member_earnings_percentage numeric(5,2) DEFAULT 5.0,
    parent_club_id bigint,
    clubrake numeric DEFAULT '10'::numeric
);


--
-- Name: crash_games; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crash_games (
    key text NOT NULL,
    game_uuids text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: crashs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crashs (
    gid text NOT NULL,
    busted numeric,
    hash text NOT NULL,
    date timestamp with time zone DEFAULT now(),
    numbers json
);


--
-- Name: credits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.credits (
    uid bigint NOT NULL,
    btc numeric DEFAULT '0'::numeric,
    eth numeric DEFAULT '0'::numeric,
    ltc numeric DEFAULT '0'::numeric,
    bch numeric DEFAULT '0'::numeric,
    usdt numeric DEFAULT '0'::numeric,
    trx numeric DEFAULT '0'::numeric,
    doge numeric DEFAULT '0'::numeric,
    ada numeric DEFAULT '0'::numeric,
    xrp numeric DEFAULT '0'::numeric,
    bnb numeric DEFAULT '0'::numeric,
    usdp numeric DEFAULT '0'::numeric,
    nexo numeric DEFAULT '0'::numeric,
    mkr numeric DEFAULT '0'::numeric,
    tusd numeric DEFAULT '0'::numeric,
    usdc numeric DEFAULT '0'::numeric,
    busd numeric DEFAULT '0'::numeric,
    nc numeric DEFAULT '0'::numeric,
    inr numeric DEFAULT '0'::numeric,
    shib numeric DEFAULT '0'::numeric,
    matic numeric DEFAULT '0'::numeric,
    sc numeric DEFAULT '0'::numeric,
    mvr numeric DEFAULT '0'::numeric,
    bjb numeric DEFAULT '0'::numeric,
    aed numeric DEFAULT '0'::numeric,
    npr numeric DEFAULT '0'::numeric,
    pkr numeric DEFAULT '0'::numeric,
    eur numeric DEFAULT '0'::numeric,
    bdt numeric
);


--
-- Name: credits_ledger_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.credits_ledger_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: credits_ledger; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.credits_ledger (
    id bigint DEFAULT nextval('public.credits_ledger_id_seq'::regclass) NOT NULL,
    user_id text NOT NULL,
    currency text DEFAULT 'INR'::text,
    amount numeric NOT NULL,
    reason text NOT NULL,
    description text,
    eventid text,
    job_id uuid,
    match_id text,
    meta jsonb,
    created_at timestamp with time zone DEFAULT now(),
    market_type text,
    sport_id text,
    commission numeric(18,2),
    netamount numeric(18,2),
    profit numeric(18,2),
    loss numeric(18,2),
    bet_id bigint,
    closing numeric(18,2),
    balance numeric(18,2) DEFAULT '0'::numeric
);


--
-- Name: cricpaytransactions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.cricpaytransactions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: cricpaytransactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cricpaytransactions (
    id bigint DEFAULT nextval('public.cricpaytransactions_id_seq'::regclass) NOT NULL,
    uid bigint NOT NULL,
    transaction_code character varying(50) NOT NULL,
    amount numeric NOT NULL,
    payment_method character varying(50) NOT NULL,
    status character varying(20) NOT NULL,
    fee numeric DEFAULT '0'::numeric,
    remark text,
    created_at timestamp without time zone NOT NULL,
    updated_at timestamp without time zone
);


--
-- Name: cronbonus; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cronbonus (
    userid bigint NOT NULL,
    viplevel integer NOT NULL,
    dailybonus integer NOT NULL,
    weeklybonus integer NOT NULL,
    monthlybonus integer NOT NULL,
    dailydate timestamp without time zone NOT NULL,
    weeklydate timestamp without time zone NOT NULL,
    monthlydate timestamp without time zone NOT NULL,
    dailyclaim boolean NOT NULL,
    weeklyclaim boolean NOT NULL,
    monthlyclaim boolean NOT NULL,
    status boolean NOT NULL
);


--
-- Name: currency_payment_details_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.currency_payment_details_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    MAXVALUE 2147483647
    CACHE 1;


--
-- Name: currency_payment_details; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.currency_payment_details (
    id integer DEFAULT nextval('public.currency_payment_details_id_seq'::regclass) NOT NULL,
    coin_type character varying(10) NOT NULL,
    bank_name character varying(255),
    account_number character varying(100),
    ifsc_code character varying(20),
    account_holder_name character varying(255),
    qr_image bytea,
    upi_id character varying(100),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    is_active boolean DEFAULT true
);


--
-- Name: deposits_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.deposits_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: deposits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.deposits (
    uid bigint NOT NULL,
    date timestamp with time zone,
    status text NOT NULL,
    txtid text NOT NULL,
    amount numeric NOT NULL,
    coin text NOT NULL,
    salt text NOT NULL,
    id bigint DEFAULT nextval('public.deposits_id_seq'::regclass) NOT NULL
);


--
-- Name: exchangerate_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.exchangerate_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    MAXVALUE 2147483647
    CACHE 1;


--
-- Name: exchangerate; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.exchangerate (
    id integer DEFAULT nextval('public.exchangerate_id_seq'::regclass) NOT NULL,
    currency character varying(10) NOT NULL,
    usd_rate numeric(24,8) NOT NULL,
    last_updated timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: executive_activity_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.executive_activity_logs (
    id integer NOT NULL,
    executive_id integer NOT NULL,
    action character varying(80) NOT NULL,
    target_type character varying(40),
    target_id character varying(40),
    details jsonb,
    ip character varying(64),
    user_agent character varying(512),
    status character varying(10) DEFAULT 'success'::character varying NOT NULL,
    error_message character varying(512),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT executive_activity_logs_status_check CHECK (((status)::text = ANY ((ARRAY['success'::character varying, 'failed'::character varying])::text[])))
);


--
-- Name: executive_activity_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.executive_activity_logs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    MAXVALUE 2147483647
    CACHE 1;


--
-- Name: executive_activity_logs_id_seq1; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.executive_activity_logs_id_seq1
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: executive_activity_logs_id_seq1; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.executive_activity_logs_id_seq1 OWNED BY public.executive_activity_logs.id;


--
-- Name: executives; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.executives (
    id integer NOT NULL,
    username character varying(100) NOT NULL,
    password character varying(255) NOT NULL,
    parent_staff_id integer NOT NULL,
    parent_role_snapshot character varying(50),
    permissions jsonb NOT NULL,
    status character varying(20) DEFAULT 'active'::character varying NOT NULL,
    last_login timestamp with time zone,
    last_login_ip character varying(64),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    kind character varying(20) DEFAULT 'executive'::character varying NOT NULL,
    CONSTRAINT executives_kind_check CHECK (((kind)::text = ANY ((ARRAY['executive'::character varying, 'marketing'::character varying])::text[]))),
    CONSTRAINT executives_status_check CHECK (((status)::text = ANY ((ARRAY['active'::character varying, 'inactive'::character varying, 'locked'::character varying])::text[])))
);


--
-- Name: executives_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.executives_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    MAXVALUE 2147483647
    CACHE 1;


--
-- Name: executives_id_seq1; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.executives_id_seq1
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: executives_id_seq1; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.executives_id_seq1 OWNED BY public.executives.id;


--
-- Name: fancymanualsettlement_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.fancymanualsettlement_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: fancymanualsettlement; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fancymanualsettlement (
    id bigint DEFAULT nextval('public.fancymanualsettlement_id_seq'::regclass) NOT NULL,
    match_id character varying(100) NOT NULL,
    eventid text NOT NULL,
    fancy_name character varying(255) NOT NULL,
    selection character varying(20) NOT NULL,
    performed_by bigint,
    notes text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    bet_id bigint,
    user_id bigint
);


--
-- Name: fancyresultsummary_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.fancyresultsummary_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    MAXVALUE 2147483647
    CACHE 1;


--
-- Name: fancyresultsummary; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fancyresultsummary (
    id integer DEFAULT nextval('public.fancyresultsummary_id_seq'::regclass) NOT NULL,
    fancyname character varying(255) NOT NULL,
    eventid bigint NOT NULL,
    matchid bigint NOT NULL,
    lastfetchdate timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: fanwins_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.fanwins_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    MAXVALUE 2147483647
    CACHE 1;


--
-- Name: fanwins; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fanwins (
    id integer DEFAULT nextval('public.fanwins_id_seq'::regclass) NOT NULL,
    userid bigint NOT NULL,
    fancyname character varying(255) NOT NULL,
    selection character varying(100) NOT NULL,
    runsodds integer NOT NULL,
    payout numeric(15,2) NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    eventid text NOT NULL,
    matchid character varying(100) NOT NULL
);


--
-- Name: fiat_deposits_deposit_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.fiat_deposits_deposit_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    MAXVALUE 2147483647
    CACHE 1;


--
-- Name: fiat_deposits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fiat_deposits (
    deposit_id integer DEFAULT nextval('public.fiat_deposits_deposit_id_seq'::regclass) NOT NULL,
    user_id bigint NOT NULL,
    amount numeric NOT NULL,
    currency text DEFAULT 'INR'::text,
    bank_name text,
    account_number text,
    ifsc_code text,
    account_holder_name text,
    upi_id text,
    screenshot_path text,
    transaction_id text,
    status text DEFAULT 'pending'::text,
    admin_comment text,
    created_at timestamp with time zone,
    handled_by integer,
    handled_at timestamp with time zone
);


--
-- Name: fiat_withdrawals_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.fiat_withdrawals_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    MAXVALUE 2147483647
    CACHE 1;


--
-- Name: fiat_withdrawals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fiat_withdrawals (
    id integer DEFAULT nextval('public.fiat_withdrawals_id_seq'::regclass) NOT NULL,
    uid bigint NOT NULL,
    date timestamp with time zone,
    amount numeric(18,2) NOT NULL,
    currency character varying(10) NOT NULL,
    bank_name character varying(100),
    account_number character varying(50),
    account_holder_name character varying(100) NOT NULL,
    ifsc_code character varying(20),
    upi_id character varying(50),
    status character varying(30) DEFAULT 'In Queue'::character varying,
    name character varying(100)
);


--
-- Name: game_runs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.game_runs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    MAXVALUE 2147483647
    CACHE 1;


--
-- Name: game_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.game_runs (
    id integer DEFAULT nextval('public.game_runs_id_seq'::regclass) NOT NULL,
    game_id integer NOT NULL,
    user_id bigint NOT NULL,
    currency character varying(10),
    mode character varying(50),
    language character varying(20),
    home_url text,
    device character varying(50),
    vendor character varying(100),
    title character varying(255),
    session_id character varying(255) NOT NULL,
    created_at timestamp with time zone,
    url text NOT NULL,
    coin text NOT NULL
);


--
-- Name: gift_cards_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.gift_cards_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: gift_cards; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.gift_cards (
    id bigint DEFAULT nextval('public.gift_cards_id_seq'::regclass) NOT NULL,
    unique_key text NOT NULL,
    description text,
    period_days integer,
    end_date date,
    deposit_status boolean DEFAULT false NOT NULL,
    deposit_amount numeric(18,2),
    wager_status boolean DEFAULT false NOT NULL,
    wager_times integer,
    all_user_status boolean DEFAULT false NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    amount numeric(18,2)
);


--
-- Name: gis_game_deletion_audit_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.gis_game_deletion_audit_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: gis_game_deletion_audit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.gis_game_deletion_audit (
    id bigint DEFAULT nextval('public.gis_game_deletion_audit_id_seq'::regclass) NOT NULL,
    uuid text NOT NULL,
    name text,
    blocked_by text,
    ref_count integer,
    skipped_at timestamp with time zone DEFAULT now() NOT NULL,
    api_checked_at timestamp with time zone
);


--
-- Name: gis_games; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.gis_games (
    uuid text NOT NULL,
    name text NOT NULL,
    provider text NOT NULL,
    type text,
    image text,
    technology text,
    has_lobby boolean DEFAULT false,
    is_mobile boolean DEFAULT false,
    has_freespins boolean DEFAULT false,
    freespin_valid_until_full_day boolean DEFAULT false,
    updated_at bigint,
    api_sub_provider_id integer,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at_timestamp timestamp without time zone
);


--
-- Name: gis_prioritized_games_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.gis_prioritized_games_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    MAXVALUE 2147483647
    CACHE 1;


--
-- Name: gis_prioritized_games; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.gis_prioritized_games (
    id integer DEFAULT nextval('public.gis_prioritized_games_id_seq'::regclass) NOT NULL,
    vendor character varying(255),
    game_ids text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: gis_prioritized_types; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.gis_prioritized_types (
    id bigint NOT NULL,
    type character varying(255) NOT NULL,
    game_ids text,
    created_at timestamp without time zone,
    updated_at timestamp without time zone
);


--
-- Name: gis_prioritized_types_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.gis_prioritized_types_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    MAXVALUE 2147483647
    CACHE 1;


--
-- Name: gis_prioritized_types_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.gis_prioritized_types_id_seq OWNED BY public.gis_prioritized_types.id;


--
-- Name: gis_providers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.gis_providers (
    name text NOT NULL
);


--
-- Name: gis_providers_new_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.gis_providers_new_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    MAXVALUE 2147483647
    CACHE 1;


--
-- Name: gis_providers_new; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.gis_providers_new (
    id integer DEFAULT nextval('public.gis_providers_new_id_seq'::regclass) NOT NULL,
    name text NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    enabled boolean DEFAULT true NOT NULL
);


--
-- Name: gis_recently_played_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.gis_recently_played_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    MAXVALUE 2147483647
    CACHE 1;


--
-- Name: gis_recently_played; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.gis_recently_played (
    id integer DEFAULT nextval('public.gis_recently_played_id_seq'::regclass) NOT NULL,
    user_id bigint NOT NULL,
    game_uuid text NOT NULL,
    played_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: gis_response_cache; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.gis_response_cache (
    transaction_id uuid NOT NULL,
    response_body jsonb NOT NULL
);


--
-- Name: gis_sessions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.gis_sessions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: gis_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.gis_sessions (
    id bigint DEFAULT nextval('public.gis_sessions_id_seq'::regclass) NOT NULL,
    user_id bigint NOT NULL,
    session_id text NOT NULL,
    game_uuid text NOT NULL,
    currency text NOT NULL,
    device text,
    return_url text,
    language text,
    lobby_data text,
    created_at timestamp with time zone DEFAULT now(),
    ended_at timestamp with time zone
);


--
-- Name: gis_transactions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.gis_transactions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: gis_transactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.gis_transactions (
    id bigint DEFAULT nextval('public.gis_transactions_id_seq'::regclass) NOT NULL,
    user_id bigint NOT NULL,
    session_id text,
    transaction_id text NOT NULL,
    action text NOT NULL,
    amount numeric,
    currency text,
    game_uuid text,
    type text,
    freespin_id text,
    quantity integer,
    round_id text,
    finished boolean,
    transaction_datetime timestamp with time zone,
    casino_request_retry_count integer,
    bet_transaction_id text,
    rollback_transactions jsonb,
    provider_round_id text,
    balance_after numeric NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    response_json jsonb
);


--
-- Name: gisgamesnew_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.gisgamesnew_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    MAXVALUE 2147483647
    CACHE 1;


--
-- Name: gisgamesnew; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.gisgamesnew (
    id integer DEFAULT nextval('public.gisgamesnew_id_seq'::regclass) NOT NULL,
    uuid text NOT NULL,
    name text,
    provider text,
    provider_id integer,
    type text,
    image text,
    technology text,
    has_lobby boolean DEFAULT false,
    is_mobile boolean DEFAULT false,
    has_freespins boolean DEFAULT false,
    freespin_valid_until_full_day boolean DEFAULT false,
    updated_at bigint,
    label text,
    parameters jsonb,
    tags jsonb,
    images jsonb,
    created_at timestamp without time zone DEFAULT now(),
    image3 text
);


--
-- Name: hot_games; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hot_games (
    key text NOT NULL,
    game_uuids text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: house_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.house_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    MAXVALUE 2147483647
    CACHE 1;


--
-- Name: house; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.house (
    uid bigint,
    max numeric DEFAULT '0'::numeric,
    current numeric DEFAULT '0'::numeric,
    id integer DEFAULT nextval('public.house_id_seq'::regclass) NOT NULL
);


--
-- Name: indian_games; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.indian_games (
    key text NOT NULL,
    game_uuids text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: inr_deposit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inr_deposit (
    uid text NOT NULL,
    date timestamp without time zone NOT NULL,
    status text NOT NULL,
    trxid text NOT NULL,
    amount text NOT NULL,
    name text NOT NULL
);


--
-- Name: js_game_sessions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.js_game_sessions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    MAXVALUE 2147483647
    CACHE 1;


--
-- Name: js_game_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.js_game_sessions (
    id integer DEFAULT nextval('public.js_game_sessions_id_seq'::regclass) NOT NULL,
    user_id bigint NOT NULL,
    game_uid character varying(255) NOT NULL,
    session_token character varying(255) NOT NULL,
    launch_url text,
    status character varying(50) DEFAULT 'active'::character varying,
    started_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    ended_at timestamp with time zone
);


--
-- Name: js_game_transactions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.js_game_transactions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    MAXVALUE 2147483647
    CACHE 1;


--
-- Name: js_game_transactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.js_game_transactions (
    id integer DEFAULT nextval('public.js_game_transactions_id_seq'::regclass) NOT NULL,
    user_id bigint NOT NULL,
    game_uid character varying(255) NOT NULL,
    transaction_type character varying(50) NOT NULL,
    amount numeric(18,8) NOT NULL,
    currency character varying(10) NOT NULL,
    transaction_status character varying(50) NOT NULL,
    external_transaction_id character varying(255),
    serial_number character varying(255),
    "timestamp" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    additional_data jsonb
);


--
-- Name: js_games_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.js_games_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    MAXVALUE 2147483647
    CACHE 1;


--
-- Name: js_games; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.js_games (
    id integer DEFAULT nextval('public.js_games_id_seq'::regclass) NOT NULL,
    game_name character varying(255) NOT NULL,
    game_uid character varying(255) NOT NULL,
    game_type character varying(100) NOT NULL,
    game_icon character varying(500),
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    vendor text
);


--
-- Name: line_runner_mapping; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.line_runner_mapping (
    eventid text NOT NULL,
    winner_id bigint NOT NULL,
    market_id text,
    outcome text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: live_casino; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.live_casino (
    key text NOT NULL,
    game_uuids text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.logs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.logs (
    id integer DEFAULT nextval('public.logs_id_seq'::regclass) NOT NULL,
    info text
);


--
-- Name: mannual_result; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mannual_result (
    id integer NOT NULL,
    eventid text,
    match_id character varying(100),
    match_title text,
    game_type character varying(100),
    market_type character varying(100),
    "winnerName" text,
    "winnerId" text,
    "fancyName" text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: mannual_result_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.mannual_result_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: mannual_result_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.mannual_result_id_seq OWNED BY public.mannual_result.id;


--
-- Name: manual_settle_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.manual_settle_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    MAXVALUE 2147483647
    CACHE 1;


--
-- Name: manual_settle; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.manual_settle (
    id integer DEFAULT nextval('public.manual_settle_id_seq'::regclass) NOT NULL,
    match_id character varying(100) NOT NULL,
    eventid text NOT NULL,
    winner_name character varying(255) NOT NULL,
    team_one character varying(255),
    team_two character varying(255),
    counts integer DEFAULT 0,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: marketwins_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.marketwins_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: marketwins; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.marketwins (
    id bigint DEFAULT nextval('public.marketwins_id_seq'::regclass) NOT NULL,
    totalbets bigint NOT NULL,
    matchid text NOT NULL,
    eventid text NOT NULL,
    team1ex numeric(18,2) NOT NULL,
    team2ex numeric(18,2) NOT NULL,
    drawex numeric(18,2),
    winteam text NOT NULL,
    matchname text NOT NULL,
    payout numeric(18,2) NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    user_id bigint
);


--
-- Name: messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.messages (
    room_key text NOT NULL,
    from_uid numeric NOT NULL,
    to_uid numeric NOT NULL,
    message text NOT NULL,
    date timestamp with time zone DEFAULT now(),
    "time" text NOT NULL,
    from_name text NOT NULL,
    to_name text NOT NULL
);


--
-- Name: notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notifications (
    title text NOT NULL,
    content text NOT NULL,
    date timestamp with time zone DEFAULT now()
);


--
-- Name: pay_in_transactions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.pay_in_transactions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    MAXVALUE 2147483647
    CACHE 1;


--
-- Name: pay_in_transactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pay_in_transactions (
    id integer DEFAULT nextval('public.pay_in_transactions_id_seq'::regclass) NOT NULL,
    user_id bigint NOT NULL,
    transaction_id character varying(255) NOT NULL,
    out_trade_no character varying(255) NOT NULL,
    currency character varying(10) NOT NULL,
    amount numeric(20,8) NOT NULL,
    pay_amount numeric(20,8),
    merchant_ratio numeric(5,2),
    real_amount numeric(20,8),
    status smallint DEFAULT '0'::smallint,
    pay_type character varying(20),
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: popular_slots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.popular_slots (
    key text NOT NULL,
    game_uuids text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: prioritized_games_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.prioritized_games_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    MAXVALUE 2147483647
    CACHE 1;


--
-- Name: prioritized_games; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.prioritized_games (
    id integer DEFAULT nextval('public.prioritized_games_id_seq'::regclass) NOT NULL,
    vendor character varying(50) NOT NULL,
    game_ids text NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: prioritized_gis_game_items_backup; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.prioritized_gis_game_items_backup (
    prioritized_id bigint,
    uuid text,
    "position" integer
);


--
-- Name: prioritized_gis_games_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.prioritized_gis_games_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: prioritized_gis_games; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.prioritized_gis_games (
    id bigint DEFAULT nextval('public.prioritized_gis_games_id_seq'::regclass) NOT NULL,
    provider text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: provider_games_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.provider_games_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: provider_games; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.provider_games (
    id bigint DEFAULT nextval('public.provider_games_id_seq'::regclass) NOT NULL,
    provider_name text NOT NULL,
    game_name text NOT NULL,
    image_url text,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: redeembonus; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.redeembonus (
    userid bigint NOT NULL,
    code text NOT NULL,
    amount integer NOT NULL,
    status text NOT NULL,
    createdat timestamp without time zone NOT NULL,
    updatedat timestamp without time zone NOT NULL,
    bonus_pct numeric(5,2),
    source character varying(20) DEFAULT 'manual'::character varying
);


--
-- Name: removed_prioritized_games_audit_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.removed_prioritized_games_audit_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: removed_prioritized_games_audit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.removed_prioritized_games_audit (
    id bigint DEFAULT nextval('public.removed_prioritized_games_audit_id_seq'::regclass) NOT NULL,
    uuid text NOT NULL,
    name text,
    provider text,
    prioritized_count integer,
    first_detected timestamp with time zone DEFAULT now(),
    last_detected timestamp with time zone DEFAULT now(),
    resolved boolean DEFAULT false,
    resolved_at timestamp with time zone,
    resolution_note text
);


--
-- Name: rewards_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.rewards_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    MAXVALUE 2147483647
    CACHE 1;


--
-- Name: rewards; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rewards (
    ownername text NOT NULL,
    membername text,
    "referalCode" text,
    amount numeric NOT NULL,
    "createdAt" timestamp with time zone,
    "updatedAt" timestamp with time zone,
    coin text,
    type text,
    locked boolean DEFAULT true,
    referalmount numeric,
    id integer DEFAULT nextval('public.rewards_id_seq'::regclass) NOT NULL
);


--
-- Name: roles_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.roles_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    MAXVALUE 2147483647
    CACHE 1;


--
-- Name: roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.roles (
    id integer DEFAULT nextval('public.roles_id_seq'::regclass) NOT NULL,
    name character varying(50) NOT NULL,
    level integer NOT NULL,
    responsibilities text
);


--
-- Name: roles_keys_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.roles_keys_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    MAXVALUE 2147483647
    CACHE 1;


--
-- Name: roles_keys; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.roles_keys (
    id integer DEFAULT nextval('public.roles_keys_id_seq'::regclass) NOT NULL,
    role_key text NOT NULL,
    role text NOT NULL
);


--
-- Name: session_1m; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.session_1m (
    sessionid character varying(250),
    status character varying(250),
    win character varying(250)
);


--
-- Name: session_2m; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.session_2m (
    sessionid character varying(250),
    status character varying(250),
    win character varying(250)
);


--
-- Name: session_30s; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.session_30s (
    sessionid character varying(250),
    status character varying(250),
    win character varying(250)
);


--
-- Name: settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.settings (
    bots text,
    id numeric
);


--
-- Name: siteconfig_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.siteconfig_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    MAXVALUE 2147483647
    CACHE 1;


--
-- Name: siteconfig; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.siteconfig (
    registerbonus numeric NOT NULL,
    createdat timestamp with time zone NOT NULL,
    updatedat timestamp with time zone NOT NULL,
    affiliatebonus numeric DEFAULT '20'::numeric,
    comissionpercent numeric DEFAULT '5'::numeric,
    inr boolean DEFAULT true,
    mvr boolean DEFAULT true,
    aed boolean DEFAULT true,
    pkr boolean DEFAULT true,
    cryptocoin boolean DEFAULT true,
    bjb boolean DEFAULT true,
    casino boolean DEFAULT true,
    lotto boolean DEFAULT true,
    vipclub boolean DEFAULT true,
    clubmembership boolean DEFAULT true,
    bonus boolean DEFAULT true,
    affiliate boolean DEFAULT true,
    crash boolean DEFAULT true,
    originals boolean DEFAULT true,
    livegames boolean DEFAULT true,
    slotsgames boolean DEFAULT true,
    alllivegames boolean DEFAULT true,
    allslotsgames boolean DEFAULT true,
    lotterygames boolean DEFAULT true,
    indiangames boolean DEFAULT true,
    cards boolean DEFAULT true,
    jilli boolean DEFAULT true,
    bdt boolean DEFAULT true,
    clubrake numeric,
    instantgames boolean DEFAULT true,
    btc boolean DEFAULT true,
    eth boolean DEFAULT true,
    ltc boolean DEFAULT true,
    bch boolean DEFAULT true,
    usdt boolean DEFAULT true,
    trx boolean DEFAULT true,
    doge boolean DEFAULT true,
    ada boolean DEFAULT true,
    xrp boolean DEFAULT true,
    bnb boolean DEFAULT true,
    usdp boolean DEFAULT true,
    nexo boolean DEFAULT true,
    mkr boolean DEFAULT true,
    tusd boolean DEFAULT true,
    usdc boolean DEFAULT true,
    busd boolean DEFAULT true,
    nc boolean DEFAULT true,
    npr boolean DEFAULT true,
    shib boolean DEFAULT true,
    matic boolean DEFAULT true,
    sc boolean DEFAULT true,
    spribe boolean DEFAULT true,
    evolution boolean DEFAULT true,
    pragmaticslots boolean DEFAULT true,
    pragmaticlive boolean DEFAULT true,
    ideal boolean DEFAULT true,
    microgaming boolean DEFAULT true,
    pgsoft boolean DEFAULT true,
    hacksawgaming boolean DEFAULT true,
    jili boolean DEFAULT true,
    netent boolean DEFAULT true,
    provablyfair boolean DEFAULT true,
    id integer DEFAULT nextval('public.siteconfig_id_seq'::regclass) NOT NULL,
    apaynotificationemail character varying(255) DEFAULT 'salvin.dev.cfz@gmail.com'::character varying,
    gmailuser character varying(255),
    gmailapppassword character varying(255),
    welcomepack boolean DEFAULT true NOT NULL,
    wheelspin boolean DEFAULT true NOT NULL,
    home_latestwins boolean DEFAULT true NOT NULL,
    home_paymentbanner boolean DEFAULT true NOT NULL,
    home_livecasino boolean DEFAULT true NOT NULL,
    home_popularslots boolean DEFAULT true NOT NULL,
    home_crashgames boolean DEFAULT true NOT NULL,
    home_leaderboard boolean DEFAULT true NOT NULL,
    home_welcomebanner boolean DEFAULT true NOT NULL,
    "home_heroSection" boolean DEFAULT true NOT NULL,
    giftcards boolean DEFAULT true NOT NULL,
    home_gamingcards boolean DEFAULT true NOT NULL,
    home_bonus500banner boolean DEFAULT true NOT NULL,
    home_promocards boolean DEFAULT true NOT NULL
);


--
-- Name: spin_wheel_claims_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.spin_wheel_claims_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    MAXVALUE 2147483647
    CACHE 1;


--
-- Name: spin_wheel_claims; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.spin_wheel_claims (
    id integer DEFAULT nextval('public.spin_wheel_claims_id_seq'::regclass) NOT NULL,
    user_id bigint NOT NULL,
    deposit_amount numeric(18,2) NOT NULL,
    reward_amount numeric(18,2) NOT NULL,
    claimed_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    slice_label character varying(50),
    redeem_code character varying(10)
);


--
-- Name: spin_wheel_config_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.spin_wheel_config_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    MAXVALUE 2147483647
    CACHE 1;


--
-- Name: spin_wheel_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.spin_wheel_config (
    id integer DEFAULT nextval('public.spin_wheel_config_id_seq'::regclass) NOT NULL,
    min_deposit numeric(18,2) DEFAULT '100'::numeric NOT NULL,
    reward_pct numeric(5,2) DEFAULT 5.00 NOT NULL,
    claim_cooldown_days integer DEFAULT 7 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    unlimited_spin boolean DEFAULT false NOT NULL
);


--
-- Name: spin_wheel_slices_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.spin_wheel_slices_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    MAXVALUE 2147483647
    CACHE 1;


--
-- Name: spin_wheel_slices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.spin_wheel_slices (
    id integer DEFAULT nextval('public.spin_wheel_slices_id_seq'::regclass) NOT NULL,
    label character varying(50) NOT NULL,
    reward_pct numeric(5,2) DEFAULT '0'::numeric NOT NULL,
    color character varying(10) DEFAULT '#000000'::character varying NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    is_bad_luck boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    weight integer DEFAULT 10 NOT NULL
);


--
-- Name: sports_bet_result_cache; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sports_bet_result_cache (
    user_id text NOT NULL,
    eventid text NOT NULL,
    match_id text NOT NULL,
    bucket text NOT NULL,
    declared boolean DEFAULT false NOT NULL,
    is_match_over boolean DEFAULT false NOT NULL,
    winner_name text,
    winner_id bigint,
    market_id text,
    market_name text,
    provider text,
    betting_type text,
    declared_at timestamp with time zone,
    api_snapshot jsonb,
    recorded_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: sports_config_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.sports_config_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    MAXVALUE 2147483647
    CACHE 1;


--
-- Name: sports_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sports_config (
    id integer DEFAULT nextval('public.sports_config_id_seq'::regclass) NOT NULL,
    game_id integer NOT NULL,
    game_name character varying(255) NOT NULL,
    enabled boolean DEFAULT false,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: sports_event_result_scan; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sports_event_result_scan (
    user_id text NOT NULL,
    eventid text NOT NULL,
    declared boolean DEFAULT false NOT NULL,
    counts jsonb DEFAULT '{}'::jsonb NOT NULL,
    checked_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: sports_event_result_summary_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.sports_event_result_summary_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sports_event_result_summary; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sports_event_result_summary (
    id bigint DEFAULT nextval('public.sports_event_result_summary_id_seq'::regclass) NOT NULL,
    user_id text NOT NULL,
    eventid text NOT NULL,
    declared boolean NOT NULL,
    counts jsonb NOT NULL,
    result_meta jsonb,
    sections jsonb,
    recorded_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: sports_event_settlement_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sports_event_settlement_jobs (
    job_id uuid NOT NULL,
    user_id text NOT NULL,
    eventid text NOT NULL,
    status text DEFAULT 'queued'::text NOT NULL,
    priority integer DEFAULT 5 NOT NULL,
    run_after timestamp with time zone DEFAULT now() NOT NULL,
    payload jsonb NOT NULL,
    error_msg text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    bet_type text,
    bet_id text
);


--
-- Name: sports_settlement_report_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.sports_settlement_report_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sports_settlement_report; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sports_settlement_report (
    id bigint DEFAULT nextval('public.sports_settlement_report_id_seq'::regclass) NOT NULL,
    job_id uuid NOT NULL,
    bet_id bigint NOT NULL,
    user_id text NOT NULL,
    eventid text NOT NULL,
    match_id text,
    game_type text NOT NULL,
    market_type text,
    fancy_name text,
    selection_name text,
    user_selection_yn text,
    resolved_winner text,
    resolved_team text,
    actual_numeric numeric,
    rule_op text,
    rule_threshold numeric,
    credit_amount numeric DEFAULT '0'::numeric NOT NULL,
    exposures_map jsonb,
    api_snapshot jsonb,
    decision_path jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: staff_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.staff_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: staff; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.staff (
    id bigint DEFAULT nextval('public.staff_id_seq'::regclass) NOT NULL,
    name text NOT NULL,
    email text NOT NULL,
    password text NOT NULL,
    password2 text,
    phone text,
    country text,
    role_id integer NOT NULL,
    parent_id bigint,
    created_at timestamp with time zone DEFAULT now(),
    percentage numeric(5,2) DEFAULT '0'::numeric,
    agent_code text,
    system_locked boolean DEFAULT false,
    first_login boolean DEFAULT true,
    transaction_password text,
    status text DEFAULT 'active'::text,
    bet_status text DEFAULT 'active'::text,
    sports_betlocked boolean DEFAULT false,
    casino_locked boolean DEFAULT false
);


--
-- Name: staff_balances; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.staff_balances (
    staff_id bigint NOT NULL,
    inr numeric DEFAULT '0'::numeric NOT NULL,
    credit_limit numeric DEFAULT '0'::numeric,
    exposure_limit numeric DEFAULT '0'::numeric,
    gt numeric DEFAULT '0'::numeric,
    casino_gt numeric DEFAULT '0'::numeric
);


--
-- Name: staff_hierarchy; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.staff_hierarchy (
    ancestor_id bigint NOT NULL,
    descendant_id bigint NOT NULL,
    depth integer NOT NULL
);


--
-- Name: staff_transfers_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.staff_transfers_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: staff_transfers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.staff_transfers (
    id bigint DEFAULT nextval('public.staff_transfers_id_seq'::regclass) NOT NULL,
    from_type text NOT NULL,
    from_id bigint NOT NULL,
    to_type text NOT NULL,
    to_id bigint NOT NULL,
    amount numeric NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    direction text,
    transfer_type character varying(20) DEFAULT 'transfer'::character varying,
    note text
);


--
-- Name: staff_whatsapp_ref; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.staff_whatsapp_ref (
    staff_id bigint NOT NULL,
    slug text NOT NULL,
    phone text NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: swap_history_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.swap_history_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: swap_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.swap_history (
    id bigint DEFAULT nextval('public.swap_history_id_seq'::regclass) NOT NULL,
    uid bigint NOT NULL,
    from_currency character varying(10) NOT NULL,
    to_currency character varying(10) NOT NULL,
    from_amount numeric(20,8) NOT NULL,
    to_amount numeric(20,8) NOT NULL,
    fee_percentage numeric(5,4) NOT NULL,
    fee_amount numeric(20,8) NOT NULL,
    fee_currency character varying(10) NOT NULL,
    usd_rate_from numeric(20,8) NOT NULL,
    usd_rate_to numeric(20,8) NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: team; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.team (
    ownername text NOT NULL,
    membername text NOT NULL,
    "referalCode" text NOT NULL,
    "createdAt" timestamp without time zone NOT NULL,
    "updatedAt" timestamp without time zone NOT NULL
);


--
-- Name: tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tokens (
    uid numeric NOT NULL,
    key text NOT NULL
);


--
-- Name: transaction_live_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.transaction_live_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    MAXVALUE 2147483647
    CACHE 1;


--
-- Name: transaction_live; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.transaction_live (
    id integer DEFAULT nextval('public.transaction_live_id_seq'::regclass) NOT NULL,
    method character varying(20),
    user_code character varying(50),
    user_balance bigint,
    game_type character varying(20),
    provider_code character varying(50),
    game_code character varying(50),
    type character varying(20),
    bet_money bigint,
    win_money bigint,
    txn_id character varying(50),
    txn_type character varying(20)
);


--
-- Name: transaction_slot_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.transaction_slot_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    MAXVALUE 2147483647
    CACHE 1;


--
-- Name: transaction_slot; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.transaction_slot (
    id integer DEFAULT nextval('public.transaction_slot_id_seq'::regclass) NOT NULL,
    method character varying(20),
    user_code character varying(50),
    user_balance bigint,
    game_type character varying(20),
    provider_code character varying(50),
    game_code character varying(50),
    type character varying(20),
    bet_money bigint,
    win_money bigint,
    txn_id character varying(50),
    txn_type character varying(20)
);


--
-- Name: transactions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.transactions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    MAXVALUE 2147483647
    CACHE 1;


--
-- Name: transactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.transactions (
    id integer DEFAULT nextval('public.transactions_id_seq'::regclass) NOT NULL,
    login character varying(255) NOT NULL,
    session_id character varying(255) NOT NULL,
    trade_id character varying(255) NOT NULL,
    bet numeric(12,2) NOT NULL,
    win numeric(12,2) NOT NULL,
    balance_before numeric(12,2) NOT NULL,
    balance_after numeric(12,2) NOT NULL,
    action character varying(255) NOT NULL,
    game_name character varying(255) NOT NULL,
    bet_info text,
    matrix text,
    date timestamp without time zone NOT NULL,
    win_lines text
);


--
-- Name: unlocked_rewards_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.unlocked_rewards_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    MAXVALUE 2147483647
    CACHE 1;


--
-- Name: unlocked_rewards; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.unlocked_rewards (
    id integer DEFAULT nextval('public.unlocked_rewards_id_seq'::regclass) NOT NULL,
    uid bigint NOT NULL,
    ownername text NOT NULL,
    membername text NOT NULL,
    "referalCode" text NOT NULL,
    amount numeric NOT NULL,
    cointype text DEFAULT 'sbc'::text,
    wager_amount numeric NOT NULL,
    "createdAt" timestamp with time zone DEFAULT now(),
    claimed boolean DEFAULT false
);


--
-- Name: upideposit_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.upideposit_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    MAXVALUE 2147483647
    CACHE 1;


--
-- Name: upideposit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.upideposit (
    id integer DEFAULT nextval('public.upideposit_id_seq'::regclass) NOT NULL,
    uid character varying(255) NOT NULL,
    transactioniduser character varying(255) NOT NULL,
    transactionidgateway character varying(255),
    transactiondate character varying(255),
    amount text NOT NULL,
    status character varying(50)
);


--
-- Name: user_2fa; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_2fa (
    uid character varying(255) NOT NULL,
    is_enabled boolean DEFAULT false,
    secret_key character varying(255),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: user_exposures_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.user_exposures_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    MAXVALUE 2147483647
    CACHE 1;


--
-- Name: user_exposures; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_exposures (
    id integer DEFAULT nextval('public.user_exposures_id_seq'::regclass) NOT NULL,
    user_id bigint NOT NULL,
    match_id character varying NOT NULL,
    team_name character varying NOT NULL,
    exposure_amount numeric NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    match_title character varying(255),
    category character varying,
    event_id character varying,
    game_type character varying
);


--
-- Name: user_gift_cards_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.user_gift_cards_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: user_gift_cards; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_gift_cards (
    id bigint DEFAULT nextval('public.user_gift_cards_id_seq'::regclass) NOT NULL,
    user_id bigint NOT NULL,
    gift_card_id bigint NOT NULL,
    start_date timestamp without time zone DEFAULT now() NOT NULL,
    status text DEFAULT 'Activated'::text NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: user_kyc_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.user_kyc_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    MAXVALUE 2147483647
    CACHE 1;


--
-- Name: user_kyc; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_kyc (
    id integer DEFAULT nextval('public.user_kyc_id_seq'::regclass) NOT NULL,
    user_id character varying(50) NOT NULL,
    first_name character varying(100),
    last_name character varying(100),
    gender character varying(20),
    date_of_birth date,
    address text,
    city character varying(100),
    country character varying(50),
    document_type character varying(20),
    id_front_path character varying(255),
    id_back_path character varying(255),
    passport_path character varying(255),
    status character varying(20) DEFAULT 'Unverified'::character varying NOT NULL,
    rejection_reason text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: user_login_history_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.user_login_history_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: user_login_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_login_history (
    id bigint DEFAULT nextval('public.user_login_history_id_seq'::regclass) NOT NULL,
    user_id bigint NOT NULL,
    ip_address text,
    user_agent text,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: user_otps; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_otps (
    id integer NOT NULL,
    email text NOT NULL,
    otp_hash text NOT NULL,
    purpose text NOT NULL,
    attempts integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    expires_at timestamp with time zone,
    is_verified boolean DEFAULT false,
    user_id bigint
);


--
-- Name: user_otps_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.user_otps_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: user_otps_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.user_otps_id_seq OWNED BY public.user_otps.id;


--
-- Name: user_otps_id_seq1; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.user_otps_id_seq1
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    MAXVALUE 2147483647
    CACHE 1;


--
-- Name: userbonus; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.userbonus (
    userid bigint NOT NULL,
    name text NOT NULL,
    totalbonus numeric NOT NULL,
    vipbonus numeric NOT NULL,
    specialbonus numeric NOT NULL,
    generalbonus numeric NOT NULL,
    createdat timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updatedat timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    joiningbonus numeric,
    dailybonus numeric DEFAULT '0'::numeric,
    weeklybonus numeric DEFAULT '0'::numeric,
    monthlybonus numeric DEFAULT '0'::numeric,
    last_daily_reset timestamp with time zone,
    last_weekly_reset timestamp with time zone,
    last_monthly_reset timestamp with time zone,
    rakebonus numeric DEFAULT '0'::numeric,
    actualdailybonus numeric(10,2) DEFAULT '0'::numeric,
    actualweeklybonus numeric(10,2) DEFAULT '0'::numeric,
    actualmonthlybonus numeric(10,2) DEFAULT '0'::numeric
);


--
-- Name: userconfig; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.userconfig (
    uid bigint NOT NULL,
    email_notifications boolean DEFAULT true,
    push_notifications boolean DEFAULT true,
    theme text DEFAULT 'dark'::text,
    language text DEFAULT 'en'::text,
    hide_balance boolean DEFAULT false,
    updatedat timestamp with time zone
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id bigint NOT NULL,
    name text NOT NULL,
    email text,
    password text NOT NULL,
    balance json,
    created timestamp with time zone DEFAULT now(),
    profit json,
    avatar text,
    wallet json,
    profit_high json,
    profit_low json,
    muted boolean DEFAULT false,
    games_played bigint DEFAULT '0'::bigint,
    level bigint DEFAULT '1'::bigint,
    friends text,
    slot_uid bigint DEFAULT '0'::bigint,
    slot_coin text,
    password2 character varying(255),
    isb boolean DEFAULT false,
    two_fa text,
    two_fa_status boolean DEFAULT false,
    rakeback numeric DEFAULT '0'::numeric,
    rakeamount numeric DEFAULT '0'::numeric,
    referalcode text,
    refree text,
    referral_link text,
    phone text,
    country text,
    parent_staff_id integer,
    role_id integer,
    bonus_type text,
    wager_multiplier integer DEFAULT 3,
    updated_at timestamp with time zone,
    is_locked boolean DEFAULT false,
    lock_targetx boolean DEFAULT false,
    status text DEFAULT 'active'::text,
    bet_status text DEFAULT 'active'::text,
    sports_betlocked boolean DEFAULT false,
    casino_locked boolean DEFAULT false,
    system_locked boolean DEFAULT false,
    gt numeric DEFAULT '0'::numeric,
    exposure_limit numeric DEFAULT '0'::numeric,
    last_ip text,
    last_login_at timestamp without time zone,
    net_win numeric DEFAULT 0 NOT NULL,
    net_loss numeric DEFAULT 0 NOT NULL,
    total_profit numeric DEFAULT 0 NOT NULL,
    casino_gt numeric DEFAULT 0,
    created_estimated boolean DEFAULT false NOT NULL
);


--
-- Name: userwager; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.userwager (
    uid bigint NOT NULL,
    wager text NOT NULL
);


--
-- Name: userwager_history_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.userwager_history_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: userwager_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.userwager_history (
    id bigint DEFAULT nextval('public.userwager_history_id_seq'::regclass) NOT NULL,
    uid bigint NOT NULL,
    previous_wager text NOT NULL,
    new_wager text NOT NULL,
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: v_fx; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_fx AS
 SELECT upper((exchangerate.currency)::text) AS cc,
    (exchangerate.usd_rate)::numeric AS usd_rate
   FROM public.exchangerate;


--
-- Name: v_staff_rollup; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_staff_rollup AS
 WITH RECURSIVE t AS (
         SELECT staff.id AS ancestor_id,
            staff.id AS descendant_id
           FROM public.staff
        UNION ALL
         SELECT t_1.ancestor_id,
            s.id
           FROM (t t_1
             JOIN public.staff s ON ((s.parent_id = t_1.descendant_id)))
        )
 SELECT t.ancestor_id AS staff_id,
    sum(sb.inr) AS tree_balance,
    max(sb2.inr) AS own_balance
   FROM ((t
     LEFT JOIN public.staff_balances sb ON ((sb.staff_id = t.descendant_id)))
     LEFT JOIN public.staff_balances sb2 ON ((sb2.staff_id = t.ancestor_id)))
  GROUP BY t.ancestor_id;


--
-- Name: vault_pro; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vault_pro (
    userid bigint NOT NULL,
    "vaultBalance" bigint NOT NULL,
    coin text NOT NULL,
    "createdAt" timestamp without time zone NOT NULL,
    "updatedAt" timestamp without time zone NOT NULL,
    "incomeDate" timestamp without time zone NOT NULL
);


--
-- Name: wager_multiplier_common_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.wager_multiplier_common_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    MAXVALUE 2147483647
    CACHE 1;


--
-- Name: wager_multiplier_common; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wager_multiplier_common (
    id integer DEFAULT nextval('public.wager_multiplier_common_id_seq'::regclass) NOT NULL,
    multiplier integer NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: wallet_history_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.wallet_history_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    MAXVALUE 2147483647
    CACHE 1;


--
-- Name: wallet_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wallet_history (
    id integer DEFAULT nextval('public.wallet_history_id_seq'::regclass) NOT NULL,
    uid bigint NOT NULL,
    username text NOT NULL,
    coin text NOT NULL,
    operation text NOT NULL,
    amount numeric NOT NULL,
    previous_balance numeric NOT NULL,
    new_balance numeric NOT NULL,
    transaction_time timestamp with time zone DEFAULT now(),
    description text
);


--
-- Name: wallets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wallets (
    address text NOT NULL,
    uid bigint NOT NULL,
    coin text NOT NULL,
    date timestamp with time zone DEFAULT now()
);


--
-- Name: windata_1m; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.windata_1m (
    uid character varying(250),
    sessionid character varying(250),
    winamount bigint,
    cointype character varying(50)
);


--
-- Name: windata_2m; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.windata_2m (
    uid character varying(250),
    sessionid character varying(250),
    winamount bigint,
    cointype character varying(50)
);


--
-- Name: windata_30s; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.windata_30s (
    uid character varying(250),
    sessionid character varying(250),
    winamount bigint,
    cointype character varying(50)
);


--
-- Name: withdrawals_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.withdrawals_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    MAXVALUE 2147483647
    CACHE 1;


--
-- Name: withdrawals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.withdrawals (
    uid bigint NOT NULL,
    date timestamp with time zone,
    amount numeric NOT NULL,
    wallet text NOT NULL,
    status text NOT NULL,
    coin text NOT NULL,
    id integer DEFAULT nextval('public.withdrawals_id_seq'::regclass) NOT NULL,
    chain text
);


--
-- Name: admin_activity_logs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_activity_logs ALTER COLUMN id SET DEFAULT nextval('public.admin_activity_logs_id_seq'::regclass);


--
-- Name: apaywithdrawals id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.apaywithdrawals ALTER COLUMN id SET DEFAULT nextval('public.apaywithdrawals_id_seq'::regclass);


--
-- Name: bonus_history id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bonus_history ALTER COLUMN id SET DEFAULT nextval('public.bonus_history_id_seq'::regclass);


--
-- Name: executive_activity_logs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.executive_activity_logs ALTER COLUMN id SET DEFAULT nextval('public.executive_activity_logs_id_seq1'::regclass);


--
-- Name: executives id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.executives ALTER COLUMN id SET DEFAULT nextval('public.executives_id_seq1'::regclass);


--
-- Name: gis_prioritized_types id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gis_prioritized_types ALTER COLUMN id SET DEFAULT nextval('public.gis_prioritized_types_id_seq'::regclass);


--
-- Name: mannual_result id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mannual_result ALTER COLUMN id SET DEFAULT nextval('public.mannual_result_id_seq'::regclass);


--
-- Name: user_otps id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_otps ALTER COLUMN id SET DEFAULT nextval('public.user_otps_id_seq'::regclass);


--
-- Name: SportsBet SportsBet_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SportsBet"
    ADD CONSTRAINT "SportsBet_pkey" PRIMARY KEY (id);


--
-- Name: admin_activity_logs admin_activity_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_activity_logs
    ADD CONSTRAINT admin_activity_logs_pkey PRIMARY KEY (id);


--
-- Name: admin_configurations admin_configurations_config_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_configurations
    ADD CONSTRAINT admin_configurations_config_key_key UNIQUE (config_key);


--
-- Name: admin_configurations admin_configurations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_configurations
    ADD CONSTRAINT admin_configurations_pkey PRIMARY KEY (config_id);


--
-- Name: apaydeposits apaydeposits_order_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.apaydeposits
    ADD CONSTRAINT apaydeposits_order_id_key UNIQUE (order_id);


--
-- Name: apaydeposits apaydeposits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.apaydeposits
    ADD CONSTRAINT apaydeposits_pkey PRIMARY KEY (id);


--
-- Name: apaywithdrawals apaywithdrawals_custom_transaction_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.apaywithdrawals
    ADD CONSTRAINT apaywithdrawals_custom_transaction_id_key UNIQUE (custom_transaction_id);


--
-- Name: apaywithdrawals apaywithdrawals_order_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.apaywithdrawals
    ADD CONSTRAINT apaywithdrawals_order_id_key UNIQUE (order_id);


--
-- Name: apaywithdrawals apaywithdrawals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.apaywithdrawals
    ADD CONSTRAINT apaywithdrawals_pkey PRIMARY KEY (id);


--
-- Name: banners banners_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.banners
    ADD CONSTRAINT banners_pkey PRIMARY KEY (id);


--
-- Name: blogs blogs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.blogs
    ADD CONSTRAINT blogs_pkey PRIMARY KEY (id);


--
-- Name: blogs blogs_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.blogs
    ADD CONSTRAINT blogs_slug_key UNIQUE (slug);


--
-- Name: bonus_history bonus_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bonus_history
    ADD CONSTRAINT bonus_history_pkey PRIMARY KEY (id);


--
-- Name: ccdeposit ccdeposit_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ccdeposit
    ADD CONSTRAINT ccdeposit_pkey PRIMARY KEY (id);


--
-- Name: club_earnings_configurations club_earnings_configurations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.club_earnings_configurations
    ADD CONSTRAINT club_earnings_configurations_pkey PRIMARY KEY (id);


--
-- Name: club_hierarchy club_hierarchy_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.club_hierarchy
    ADD CONSTRAINT club_hierarchy_pkey PRIMARY KEY (ancestor_id, descendant_id);


--
-- Name: clubs clubs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clubs
    ADD CONSTRAINT clubs_pkey PRIMARY KEY (id);


--
-- Name: crash_games crash_games_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crash_games
    ADD CONSTRAINT crash_games_pkey PRIMARY KEY (key);


--
-- Name: credits_ledger credits_ledger_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.credits_ledger
    ADD CONSTRAINT credits_ledger_pkey PRIMARY KEY (id);


--
-- Name: credits credits_uid_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.credits
    ADD CONSTRAINT credits_uid_unique UNIQUE (uid);


--
-- Name: cricpaytransactions cricpaytransactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cricpaytransactions
    ADD CONSTRAINT cricpaytransactions_pkey PRIMARY KEY (id);


--
-- Name: cricpaytransactions cricpaytransactions_transaction_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cricpaytransactions
    ADD CONSTRAINT cricpaytransactions_transaction_code_key UNIQUE (transaction_code);


--
-- Name: currency_payment_details currency_payment_details_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.currency_payment_details
    ADD CONSTRAINT currency_payment_details_pkey PRIMARY KEY (id);


--
-- Name: exchangerate exchangerate_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exchangerate
    ADD CONSTRAINT exchangerate_pkey PRIMARY KEY (id);


--
-- Name: executive_activity_logs executive_activity_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.executive_activity_logs
    ADD CONSTRAINT executive_activity_logs_pkey PRIMARY KEY (id);


--
-- Name: executives executives_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.executives
    ADD CONSTRAINT executives_pkey PRIMARY KEY (id);


--
-- Name: executives executives_username_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.executives
    ADD CONSTRAINT executives_username_key UNIQUE (username);


--
-- Name: fancymanualsettlement fancymanualsettlement_match_id_eventid_fancy_name_bet_id; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fancymanualsettlement
    ADD CONSTRAINT fancymanualsettlement_match_id_eventid_fancy_name_bet_id UNIQUE (match_id, eventid, fancy_name, bet_id);


--
-- Name: fancymanualsettlement fancymanualsettlement_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fancymanualsettlement
    ADD CONSTRAINT fancymanualsettlement_pkey PRIMARY KEY (id);


--
-- Name: fancyresultsummary fancyresultsummary_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fancyresultsummary
    ADD CONSTRAINT fancyresultsummary_pkey PRIMARY KEY (id);


--
-- Name: fanwins fanwins_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fanwins
    ADD CONSTRAINT fanwins_pkey PRIMARY KEY (id);


--
-- Name: fiat_deposits fiat_deposits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fiat_deposits
    ADD CONSTRAINT fiat_deposits_pkey PRIMARY KEY (deposit_id);


--
-- Name: fiat_deposits fiat_deposits_transaction_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fiat_deposits
    ADD CONSTRAINT fiat_deposits_transaction_id_key UNIQUE (transaction_id);


--
-- Name: fiat_withdrawals fiat_withdrawals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fiat_withdrawals
    ADD CONSTRAINT fiat_withdrawals_pkey PRIMARY KEY (id);


--
-- Name: game_runs game_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_runs
    ADD CONSTRAINT game_runs_pkey PRIMARY KEY (id);


--
-- Name: gift_cards gift_cards_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gift_cards
    ADD CONSTRAINT gift_cards_pkey PRIMARY KEY (id);


--
-- Name: gift_cards gift_cards_unique_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gift_cards
    ADD CONSTRAINT gift_cards_unique_key_key UNIQUE (unique_key);


--
-- Name: gis_game_deletion_audit gis_game_deletion_audit_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gis_game_deletion_audit
    ADD CONSTRAINT gis_game_deletion_audit_pkey PRIMARY KEY (id);


--
-- Name: gis_games gis_games_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gis_games
    ADD CONSTRAINT gis_games_pkey PRIMARY KEY (uuid);


--
-- Name: gis_prioritized_games gis_prioritized_games_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gis_prioritized_games
    ADD CONSTRAINT gis_prioritized_games_pkey PRIMARY KEY (id);


--
-- Name: gis_prioritized_types gis_prioritized_types_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gis_prioritized_types
    ADD CONSTRAINT gis_prioritized_types_pkey PRIMARY KEY (id);


--
-- Name: gis_providers gis_providers_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gis_providers
    ADD CONSTRAINT gis_providers_name_key UNIQUE (name);


--
-- Name: gis_providers_new gis_providers_new_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gis_providers_new
    ADD CONSTRAINT gis_providers_new_name_key UNIQUE (name);


--
-- Name: gis_providers_new gis_providers_new_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gis_providers_new
    ADD CONSTRAINT gis_providers_new_pkey PRIMARY KEY (id);


--
-- Name: gis_recently_played gis_recently_played_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gis_recently_played
    ADD CONSTRAINT gis_recently_played_pkey PRIMARY KEY (id);


--
-- Name: gis_recently_played gis_recently_played_user_game_uniq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gis_recently_played
    ADD CONSTRAINT gis_recently_played_user_game_uniq UNIQUE (user_id, game_uuid);


--
-- Name: gis_response_cache gis_response_cache_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gis_response_cache
    ADD CONSTRAINT gis_response_cache_pkey PRIMARY KEY (transaction_id);


--
-- Name: gis_sessions gis_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gis_sessions
    ADD CONSTRAINT gis_sessions_pkey PRIMARY KEY (id);


--
-- Name: gis_sessions gis_sessions_session_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gis_sessions
    ADD CONSTRAINT gis_sessions_session_id_key UNIQUE (session_id);


--
-- Name: gis_transactions gis_transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gis_transactions
    ADD CONSTRAINT gis_transactions_pkey PRIMARY KEY (id);


--
-- Name: gis_transactions gis_transactions_transaction_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gis_transactions
    ADD CONSTRAINT gis_transactions_transaction_id_key UNIQUE (transaction_id);


--
-- Name: gisgamesnew gisgamesnew_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gisgamesnew
    ADD CONSTRAINT gisgamesnew_pkey PRIMARY KEY (id);


--
-- Name: gisgamesnew gisgamesnew_uuid_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gisgamesnew
    ADD CONSTRAINT gisgamesnew_uuid_key UNIQUE (uuid);


--
-- Name: hot_games hot_games_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hot_games
    ADD CONSTRAINT hot_games_pkey PRIMARY KEY (key);


--
-- Name: indian_games indian_games_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.indian_games
    ADD CONSTRAINT indian_games_pkey PRIMARY KEY (key);


--
-- Name: js_game_sessions js_game_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.js_game_sessions
    ADD CONSTRAINT js_game_sessions_pkey PRIMARY KEY (id);


--
-- Name: js_game_sessions js_game_sessions_session_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.js_game_sessions
    ADD CONSTRAINT js_game_sessions_session_token_key UNIQUE (session_token);


--
-- Name: js_game_transactions js_game_transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.js_game_transactions
    ADD CONSTRAINT js_game_transactions_pkey PRIMARY KEY (id);


--
-- Name: js_games js_games_game_uid_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.js_games
    ADD CONSTRAINT js_games_game_uid_key UNIQUE (game_uid);


--
-- Name: js_games js_games_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.js_games
    ADD CONSTRAINT js_games_pkey PRIMARY KEY (id);


--
-- Name: line_runner_mapping line_mapping_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.line_runner_mapping
    ADD CONSTRAINT line_mapping_pk PRIMARY KEY (eventid, winner_id);


--
-- Name: live_casino live_casino_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.live_casino
    ADD CONSTRAINT live_casino_pkey PRIMARY KEY (key);


--
-- Name: mannual_result mannual_result_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mannual_result
    ADD CONSTRAINT mannual_result_pkey PRIMARY KEY (id);


--
-- Name: manual_settle manual_settle_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.manual_settle
    ADD CONSTRAINT manual_settle_pkey PRIMARY KEY (id);


--
-- Name: marketwins marketwins_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketwins
    ADD CONSTRAINT marketwins_pkey PRIMARY KEY (id);


--
-- Name: pay_in_transactions pay_in_transactions_out_trade_no_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pay_in_transactions
    ADD CONSTRAINT pay_in_transactions_out_trade_no_key UNIQUE (out_trade_no);


--
-- Name: pay_in_transactions pay_in_transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pay_in_transactions
    ADD CONSTRAINT pay_in_transactions_pkey PRIMARY KEY (id);


--
-- Name: popular_slots popular_slots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.popular_slots
    ADD CONSTRAINT popular_slots_pkey PRIMARY KEY (key);


--
-- Name: prioritized_games prioritized_games_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prioritized_games
    ADD CONSTRAINT prioritized_games_pkey PRIMARY KEY (id);


--
-- Name: prioritized_games prioritized_games_vendor_uniq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prioritized_games
    ADD CONSTRAINT prioritized_games_vendor_uniq UNIQUE (vendor);


--
-- Name: prioritized_gis_games prioritized_gis_games_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prioritized_gis_games
    ADD CONSTRAINT prioritized_gis_games_pkey PRIMARY KEY (id);


--
-- Name: prioritized_gis_games prioritized_gis_games_provider_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prioritized_gis_games
    ADD CONSTRAINT prioritized_gis_games_provider_key UNIQUE (provider);


--
-- Name: provider_games provider_games_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.provider_games
    ADD CONSTRAINT provider_games_pkey PRIMARY KEY (id);


--
-- Name: removed_prioritized_games_audit removed_prioritized_games_audit_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.removed_prioritized_games_audit
    ADD CONSTRAINT removed_prioritized_games_audit_pkey PRIMARY KEY (id);


--
-- Name: removed_prioritized_games_audit removed_prioritized_games_audit_uuid_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.removed_prioritized_games_audit
    ADD CONSTRAINT removed_prioritized_games_audit_uuid_key UNIQUE (uuid);


--
-- Name: roles_keys roles_keys_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles_keys
    ADD CONSTRAINT roles_keys_pkey PRIMARY KEY (id);


--
-- Name: roles_keys roles_keys_role_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles_keys
    ADD CONSTRAINT roles_keys_role_key_key UNIQUE (role_key);


--
-- Name: roles roles_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_name_key UNIQUE (name);


--
-- Name: roles roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_pkey PRIMARY KEY (id);


--
-- Name: sports_event_settlement_jobs settlement_jobs_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sports_event_settlement_jobs
    ADD CONSTRAINT settlement_jobs_unique UNIQUE (user_id, eventid, bet_id);


--
-- Name: spin_wheel_claims spin_wheel_claims_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.spin_wheel_claims
    ADD CONSTRAINT spin_wheel_claims_pkey PRIMARY KEY (id);


--
-- Name: spin_wheel_config spin_wheel_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.spin_wheel_config
    ADD CONSTRAINT spin_wheel_config_pkey PRIMARY KEY (id);


--
-- Name: spin_wheel_slices spin_wheel_slices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.spin_wheel_slices
    ADD CONSTRAINT spin_wheel_slices_pkey PRIMARY KEY (id);


--
-- Name: sports_bet_result_cache sports_bet_result_cache_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sports_bet_result_cache
    ADD CONSTRAINT sports_bet_result_cache_pk PRIMARY KEY (user_id, eventid, match_id, bucket);


--
-- Name: sports_config sports_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sports_config
    ADD CONSTRAINT sports_config_pkey PRIMARY KEY (id);


--
-- Name: sports_event_result_scan sports_event_result_scan_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sports_event_result_scan
    ADD CONSTRAINT sports_event_result_scan_pk PRIMARY KEY (user_id, eventid);


--
-- Name: sports_event_result_summary sports_event_result_summary_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sports_event_result_summary
    ADD CONSTRAINT sports_event_result_summary_pkey PRIMARY KEY (id);


--
-- Name: sports_event_settlement_jobs sports_event_settlement_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sports_event_settlement_jobs
    ADD CONSTRAINT sports_event_settlement_jobs_pkey PRIMARY KEY (job_id);


--
-- Name: sports_settlement_report sports_settlement_report_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sports_settlement_report
    ADD CONSTRAINT sports_settlement_report_pkey PRIMARY KEY (id);


--
-- Name: staff staff_agent_code_uidx; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff
    ADD CONSTRAINT staff_agent_code_uidx UNIQUE (agent_code);


--
-- Name: staff_balances staff_balances_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_balances
    ADD CONSTRAINT staff_balances_pkey PRIMARY KEY (staff_id);


--
-- Name: staff staff_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff
    ADD CONSTRAINT staff_email_key UNIQUE (email);


--
-- Name: staff_hierarchy staff_hierarchy_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_hierarchy
    ADD CONSTRAINT staff_hierarchy_pkey PRIMARY KEY (ancestor_id, descendant_id);


--
-- Name: staff staff_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff
    ADD CONSTRAINT staff_pkey PRIMARY KEY (id);


--
-- Name: staff_transfers staff_transfers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_transfers
    ADD CONSTRAINT staff_transfers_pkey PRIMARY KEY (id);


--
-- Name: staff_whatsapp_ref staff_whatsapp_ref_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_whatsapp_ref
    ADD CONSTRAINT staff_whatsapp_ref_pkey PRIMARY KEY (staff_id);


--
-- Name: staff_whatsapp_ref staff_whatsapp_ref_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_whatsapp_ref
    ADD CONSTRAINT staff_whatsapp_ref_slug_key UNIQUE (slug);


--
-- Name: swap_history swap_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.swap_history
    ADD CONSTRAINT swap_history_pkey PRIMARY KEY (id);


--
-- Name: transaction_live transaction_live_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transaction_live
    ADD CONSTRAINT transaction_live_pkey PRIMARY KEY (id);


--
-- Name: transaction_slot transaction_slot_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transaction_slot
    ADD CONSTRAINT transaction_slot_pkey PRIMARY KEY (id);


--
-- Name: transactions transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_pkey PRIMARY KEY (id);


--
-- Name: exchangerate unique_currency; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exchangerate
    ADD CONSTRAINT unique_currency UNIQUE (currency);


--
-- Name: users unique_email; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT unique_email UNIQUE (email);


--
-- Name: userwager unique_uid; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.userwager
    ADD CONSTRAINT unique_uid UNIQUE (uid);


--
-- Name: unlocked_rewards unlocked_rewards_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.unlocked_rewards
    ADD CONSTRAINT unlocked_rewards_pkey PRIMARY KEY (id);


--
-- Name: upideposit upideposit_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.upideposit
    ADD CONSTRAINT upideposit_pkey PRIMARY KEY (id);


--
-- Name: user_2fa user_2fa_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_2fa
    ADD CONSTRAINT user_2fa_pkey PRIMARY KEY (uid);


--
-- Name: user_exposures user_exposures_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_exposures
    ADD CONSTRAINT user_exposures_pkey PRIMARY KEY (id);


--
-- Name: user_exposures user_exposures_user_id_match_id_team_name_game_type; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_exposures
    ADD CONSTRAINT user_exposures_user_id_match_id_team_name_game_type UNIQUE (user_id, match_id, team_name, game_type);


--
-- Name: user_gift_cards user_gift_cards_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_gift_cards
    ADD CONSTRAINT user_gift_cards_pkey PRIMARY KEY (id);


--
-- Name: user_gift_cards user_gift_cards_user_id_gift_card_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_gift_cards
    ADD CONSTRAINT user_gift_cards_user_id_gift_card_id_key UNIQUE (user_id, gift_card_id);


--
-- Name: user_kyc user_kyc_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_kyc
    ADD CONSTRAINT user_kyc_pkey PRIMARY KEY (id);


--
-- Name: user_kyc user_kyc_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_kyc
    ADD CONSTRAINT user_kyc_user_id_key UNIQUE (user_id);


--
-- Name: user_login_history user_login_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_login_history
    ADD CONSTRAINT user_login_history_pkey PRIMARY KEY (id);


--
-- Name: user_otps user_otps_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_otps
    ADD CONSTRAINT user_otps_pkey PRIMARY KEY (id);


--
-- Name: userbonus userbonus_userid_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.userbonus
    ADD CONSTRAINT userbonus_userid_unique UNIQUE (userid);


--
-- Name: userconfig userconfig_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.userconfig
    ADD CONSTRAINT userconfig_pkey PRIMARY KEY (uid);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: userwager_history userwager_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.userwager_history
    ADD CONSTRAINT userwager_history_pkey PRIMARY KEY (id);


--
-- Name: sports_settlement_report ux_settlement_report_bet; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sports_settlement_report
    ADD CONSTRAINT ux_settlement_report_bet UNIQUE (bet_id);


--
-- Name: wager_multiplier_common wager_multiplier_common_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wager_multiplier_common
    ADD CONSTRAINT wager_multiplier_common_pkey PRIMARY KEY (id);


--
-- Name: wallet_history wallet_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wallet_history
    ADD CONSTRAINT wallet_history_pkey PRIMARY KEY (id);


--
-- Name: withdrawals withdrawals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.withdrawals
    ADD CONSTRAINT withdrawals_pkey PRIMARY KEY (id);


--
-- Name: bonus_history_user_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX bonus_history_user_active_idx ON public.bonus_history USING btree (userid, is_claimed, is_unclaimable, claim_deadline);


--
-- Name: bonus_history_user_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX bonus_history_user_created_idx ON public.bonus_history USING btree (userid, created_at DESC);


--
-- Name: bonus_history_user_type_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX bonus_history_user_type_idx ON public.bonus_history USING btree (userid, bonus_type, is_claimed, is_unclaimable);


--
-- Name: fiat_withdrawals_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX fiat_withdrawals_date_idx ON public.fiat_withdrawals USING btree (date);


--
-- Name: fiat_withdrawals_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX fiat_withdrawals_status_idx ON public.fiat_withdrawals USING btree (status);


--
-- Name: fiat_withdrawals_uid_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX fiat_withdrawals_uid_idx ON public.fiat_withdrawals USING btree (uid);


--
-- Name: gis_prioritized_types_type_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX gis_prioritized_types_type_uniq ON public.gis_prioritized_types USING btree (lower(TRIM(BOTH FROM type)));


--
-- Name: gis_recently_played_user_played_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX gis_recently_played_user_played_idx ON public.gis_recently_played USING btree (user_id, played_at DESC);


--
-- Name: idx_admin_activity_action; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_admin_activity_action ON public.admin_activity_logs USING btree (action);


--
-- Name: idx_admin_activity_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_admin_activity_created ON public.admin_activity_logs USING btree (created_at DESC);


--
-- Name: idx_admin_activity_executive_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_admin_activity_executive_created ON public.admin_activity_logs USING btree (executive_id, created_at DESC);


--
-- Name: idx_admin_activity_staff_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_admin_activity_staff_created ON public.admin_activity_logs USING btree (staff_id, created_at DESC);


--
-- Name: idx_apaydeposits_order_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_apaydeposits_order_id ON public.apaydeposits USING btree (order_id);


--
-- Name: idx_apaydeposits_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_apaydeposits_status ON public.apaydeposits USING btree (status);


--
-- Name: idx_apaydeposits_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_apaydeposits_user_id ON public.apaydeposits USING btree (user_id);


--
-- Name: idx_apaywithdrawals_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_apaywithdrawals_status ON public.apaywithdrawals USING btree (status);


--
-- Name: idx_apaywithdrawals_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_apaywithdrawals_user_id ON public.apaywithdrawals USING btree (user_id);


--
-- Name: idx_bet_round; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bet_round ON public.gis_transactions USING btree (transaction_id, round_id);


--
-- Name: idx_blogs_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_blogs_category ON public.blogs USING btree (category);


--
-- Name: idx_blogs_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_blogs_created_at ON public.blogs USING btree (created_at DESC);


--
-- Name: idx_blogs_slug; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_blogs_slug ON public.blogs USING btree (slug);


--
-- Name: idx_credits_ledger_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_credits_ledger_created_at ON public.credits_ledger USING btree (created_at);


--
-- Name: idx_credits_ledger_eventid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_credits_ledger_eventid ON public.credits_ledger USING btree (eventid);


--
-- Name: idx_credits_ledger_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_credits_ledger_user_id ON public.credits_ledger USING btree (user_id);


--
-- Name: idx_currency; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_currency ON public.exchangerate USING btree (currency);


--
-- Name: idx_currency_payment_details_coin_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_currency_payment_details_coin_type ON public.currency_payment_details USING btree (coin_type);


--
-- Name: idx_exec_activity_action; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_exec_activity_action ON public.executive_activity_logs USING btree (action);


--
-- Name: idx_exec_activity_executive_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_exec_activity_executive_created ON public.executive_activity_logs USING btree (executive_id, created_at DESC);


--
-- Name: idx_executives_kind; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_executives_kind ON public.executives USING btree (kind);


--
-- Name: idx_executives_parent_staff_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_executives_parent_staff_id ON public.executives USING btree (parent_staff_id);


--
-- Name: idx_executives_username; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_executives_username ON public.executives USING btree (username);


--
-- Name: idx_fancymanual_by_match_event; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fancymanual_by_match_event ON public.fancymanualsettlement USING btree (match_id, eventid);


--
-- Name: idx_fiat_deposits_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fiat_deposits_status ON public.fiat_deposits USING btree (status);


--
-- Name: idx_fiat_deposits_transaction_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fiat_deposits_transaction_id ON public.fiat_deposits USING btree (transaction_id);


--
-- Name: idx_fiat_deposits_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fiat_deposits_user_id ON public.fiat_deposits USING btree (user_id);


--
-- Name: idx_game_sessions_game; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_game_sessions_game ON public.js_game_sessions USING btree (game_uid);


--
-- Name: idx_game_sessions_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_game_sessions_user ON public.js_game_sessions USING btree (user_id);


--
-- Name: idx_game_transactions_game; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_game_transactions_game ON public.js_game_transactions USING btree (game_uid);


--
-- Name: idx_game_transactions_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_game_transactions_user ON public.js_game_transactions USING btree (user_id);


--
-- Name: idx_gis_games_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gis_games_name ON public.gis_games USING btree (name);


--
-- Name: idx_gis_games_provider; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gis_games_provider ON public.gis_games USING btree (provider);


--
-- Name: idx_gis_games_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gis_games_type ON public.gis_games USING btree (type);


--
-- Name: idx_gis_transactions_action; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gis_transactions_action ON public.gis_transactions USING btree (action);


--
-- Name: idx_gis_transactions_bet_transaction_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gis_transactions_bet_transaction_id ON public.gis_transactions USING btree (bet_transaction_id);


--
-- Name: idx_gis_transactions_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gis_transactions_created_at ON public.gis_transactions USING btree (created_at DESC);


--
-- Name: idx_gis_transactions_round_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gis_transactions_round_id ON public.gis_transactions USING btree (round_id);


--
-- Name: idx_gis_transactions_transaction_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gis_transactions_transaction_id ON public.gis_transactions USING btree (transaction_id);


--
-- Name: idx_gis_transactions_user_currency; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gis_transactions_user_currency ON public.gis_transactions USING btree (user_id, currency);


--
-- Name: idx_gis_transactions_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gis_transactions_user_id ON public.gis_transactions USING btree (user_id);


--
-- Name: idx_gisgamesnew_provider; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gisgamesnew_provider ON public.gisgamesnew USING btree (provider);


--
-- Name: idx_mannual_result_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mannual_result_lookup ON public.mannual_result USING btree (eventid, match_id, game_type, market_type, created_at DESC);


--
-- Name: idx_payin_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payin_status ON public.pay_in_transactions USING btree (status);


--
-- Name: idx_payin_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payin_user_id ON public.pay_in_transactions USING btree (user_id);


--
-- Name: idx_prior_gis_games_provider; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_prior_gis_games_provider ON public.prioritized_gis_games USING btree (provider);


--
-- Name: idx_staff_transfers_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_staff_transfers_type ON public.staff_transfers USING btree (transfer_type);


--
-- Name: idx_swap_history_uid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_swap_history_uid ON public.swap_history USING btree (uid);


--
-- Name: idx_swc_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_swc_user ON public.spin_wheel_claims USING btree (user_id);


--
-- Name: idx_user_kyc_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_kyc_user_id ON public.user_kyc USING btree (user_id);


--
-- Name: idx_user_login_history_user_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_login_history_user_created ON public.user_login_history USING btree (user_id, created_at DESC);


--
-- Name: idx_user_login_history_user_ip; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_login_history_user_ip ON public.user_login_history USING btree (user_id, ip_address);


--
-- Name: idx_users_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_created ON public.users USING btree (created);


--
-- Name: idx_users_created_estimated; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_created_estimated ON public.users USING btree (created_estimated);


--
-- Name: idx_users_parent_staff_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_parent_staff_id ON public.users USING btree (parent_staff_id);


--
-- Name: idx_userwager_history_uid_updated_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_userwager_history_uid_updated_at ON public.userwager_history USING btree (uid, updated_at);


--
-- Name: idx_userwager_uid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_userwager_uid ON public.userwager USING btree (uid);


--
-- Name: staff_transfers_from_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX staff_transfers_from_id_idx ON public.staff_transfers USING btree (from_type, from_id);


--
-- Name: staff_transfers_to_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX staff_transfers_to_id_idx ON public.staff_transfers USING btree (to_type, to_id);


--
-- Name: staff_whatsapp_ref_slug_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX staff_whatsapp_ref_slug_idx ON public.staff_whatsapp_ref USING btree (slug);


--
-- Name: uniq_refund_per_bet; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX uniq_refund_per_bet ON public.gis_transactions USING btree (bet_transaction_id);


--
-- Name: admin_activity_logs admin_activity_logs_executive_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_activity_logs
    ADD CONSTRAINT admin_activity_logs_executive_id_fkey FOREIGN KEY (executive_id) REFERENCES public.executives(id) ON DELETE SET NULL;


--
-- Name: admin_activity_logs admin_activity_logs_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_activity_logs
    ADD CONSTRAINT admin_activity_logs_staff_id_fkey FOREIGN KEY (staff_id) REFERENCES public.staff(id) ON DELETE CASCADE;


--
-- Name: cricpaytransactions cricpaytransactions_uid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cricpaytransactions
    ADD CONSTRAINT cricpaytransactions_uid_fkey FOREIGN KEY (uid) REFERENCES public.credits(uid);


--
-- Name: executive_activity_logs executive_activity_logs_executive_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.executive_activity_logs
    ADD CONSTRAINT executive_activity_logs_executive_id_fkey FOREIGN KEY (executive_id) REFERENCES public.executives(id) ON DELETE CASCADE;


--
-- Name: executives executives_parent_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.executives
    ADD CONSTRAINT executives_parent_staff_id_fkey FOREIGN KEY (parent_staff_id) REFERENCES public.staff(id) ON DELETE CASCADE;


--
-- Name: fiat_deposits fiat_deposits_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fiat_deposits
    ADD CONSTRAINT fiat_deposits_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_otps fk_email; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_otps
    ADD CONSTRAINT fk_email FOREIGN KEY (email) REFERENCES public.users(email) ON DELETE CASCADE;


--
-- Name: user_gift_cards fk_user_gift_card; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_gift_cards
    ADD CONSTRAINT fk_user_gift_card FOREIGN KEY (gift_card_id) REFERENCES public.gift_cards(id) ON DELETE CASCADE;


--
-- Name: gis_transactions gis_transactions_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gis_transactions
    ADD CONSTRAINT gis_transactions_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.gis_sessions(session_id);


--
-- Name: staff_balances staff_balances_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_balances
    ADD CONSTRAINT staff_balances_staff_id_fkey FOREIGN KEY (staff_id) REFERENCES public.staff(id) ON DELETE CASCADE;


--
-- Name: staff_hierarchy staff_hierarchy_ancestor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_hierarchy
    ADD CONSTRAINT staff_hierarchy_ancestor_id_fkey FOREIGN KEY (ancestor_id) REFERENCES public.staff(id) ON DELETE CASCADE;


--
-- Name: staff_hierarchy staff_hierarchy_descendant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_hierarchy
    ADD CONSTRAINT staff_hierarchy_descendant_id_fkey FOREIGN KEY (descendant_id) REFERENCES public.staff(id) ON DELETE CASCADE;


--
-- Name: staff staff_parent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff
    ADD CONSTRAINT staff_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.staff(id);


--
-- Name: staff staff_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff
    ADD CONSTRAINT staff_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.roles(id);


--
-- Name: staff_whatsapp_ref staff_whatsapp_ref_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_whatsapp_ref
    ADD CONSTRAINT staff_whatsapp_ref_staff_id_fkey FOREIGN KEY (staff_id) REFERENCES public.staff(id) ON DELETE CASCADE;


--
-- Name: userconfig userconfig_uid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.userconfig
    ADD CONSTRAINT userconfig_uid_fkey FOREIGN KEY (uid) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: users users_parent_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_parent_staff_id_fkey FOREIGN KEY (parent_staff_id) REFERENCES public.staff(id);


--
-- Name: userwager_history userwager_history_uid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.userwager_history
    ADD CONSTRAINT userwager_history_uid_fkey FOREIGN KEY (uid) REFERENCES public.userwager(uid) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--


