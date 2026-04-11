import { initializeApp } from 'firebase/app';
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut } from 'firebase/auth';
import { getFirestore, doc, setDoc, getDoc, collection, addDoc, query, orderBy, onSnapshot, deleteDoc, serverTimestamp } from 'firebase/firestore';
import firebaseConfig from './firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
export const provider = new GoogleAuthProvider();

export const signIn = async () => {
    try {
        await signInWithPopup(auth, provider);
    } catch (error) {
        console.error("Error signing in", error);
    }
};

export const logOut = async () => {
    try {
        await signOut(auth);
    } catch (error) {
        console.error("Error signing out", error);
    }
};
