import type { Session, User } from "@supabase/supabase-js";
import { createContext, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { isSupabaseConfigured, supabase } from "../lib/supabase";
export type SignUpResult={status:"authenticated"|"confirmation-required"|"existing-account"};
export interface AuthContextValue { session:Session|null; user:User|null; loading:boolean; configured:boolean; signIn:(email:string,password:string)=>Promise<void>; signUp:(email:string,password:string)=>Promise<SignUpResult>; signOut:()=>Promise<void>; }
export const AuthContext=createContext<AuthContextValue|undefined>(undefined);
export function AuthProvider({children}:{children:ReactNode}){
 const[session,setSession]=useState<Session|null>(null);const[loading,setLoading]=useState(isSupabaseConfigured);
 useEffect(()=>{if(!supabase){setLoading(false);return}let active=true;void supabase.auth.getSession().then(({data,error})=>{if(!active)return;if(error)console.error("Unable to restore session",error.message);setSession(data.session??null);setLoading(false)});const{data}=supabase.auth.onAuthStateChange((_event,next)=>{setSession(next);setLoading(false)});return()=>{active=false;data.subscription.unsubscribe()}},[]);
 const signIn=useCallback(async(email:string,password:string)=>{if(!supabase)throw new Error("Supabase is not configured for this frontend.");const{data,error}=await supabase.auth.signInWithPassword({email,password});if(error)throw error;setSession(data.session)},[]);
 const signUp=useCallback(async(email:string,password:string):Promise<SignUpResult>=>{if(!supabase)throw new Error("Supabase is not configured for this frontend.");const emailRedirectTo=new URL("/auth/callback",window.location.origin).toString();const{data,error}=await supabase.auth.signUp({email,password,options:{emailRedirectTo}});if(error)throw error;if(data.session){setSession(data.session);return{status:"authenticated"}}if(data.user&&Array.isArray(data.user.identities)&&data.user.identities.length===0)return{status:"existing-account"};return{status:"confirmation-required"}},[]);
 const signOut=useCallback(async()=>{if(!supabase)return;const{error}=await supabase.auth.signOut();if(error)throw error},[]);
 const value=useMemo(()=>({session,user:session?.user??null,loading,configured:isSupabaseConfigured,signIn,signUp,signOut}),[session,loading,signIn,signUp,signOut]);return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
