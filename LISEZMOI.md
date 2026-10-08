# Quick Note — installation

## 1. Créer la base de données (Supabase, gratuit, ~5 min)
1. Créez un compte sur https://supabase.com, puis **New project**.
2. **SQL Editor → New query** : collez le contenu de `supabase.sql`, puis **Run**.
3. **Authentication → URL Configuration** : *Site URL* = adresse de l'app (étape 2),
   et ajoutez la même adresse dans *Redirect URLs*.
4. **Project Settings → API Keys** : copiez *Project URL* et la clé *publishable* dans `config.js`.

Connexion : l'app envoie un e-mail « Your sign-in link » ; touchez *Sign in* sur l'appareil à connecter.

## 2. Mettre l'app en ligne
L'app est un site statique (GitHub Pages, Netlify…), forcément en HTTPS pour que le micro fonctionne.

## 3. Installer sur Android
Ouvrez l'adresse dans **Chrome** → menu ⋮ → **Installer l'application**.
L'icône Quick Note apparaît sur l'écran d'accueil.

## 4. Sur Mac
Ouvrez la même adresse dans Chrome → icône d'installation dans la barre d'adresse.
Connectez-vous avec le même e-mail : les notes sont synchronisées.
