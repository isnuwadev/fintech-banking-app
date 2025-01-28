'use server';

import { ID } from "node-appwrite";
import { createAdminClient, createSessionClient } from "../appwrite";
import { cookies } from "next/headers";
import { extractCustomerIdFromUrl, parseStringify, encryptId } from "../utils";
import { CountryCode, ProcessorTokenCreateRequest, ProcessorTokenCreateRequestProcessorEnum, Products } from "plaid";
import { plaidClient } from "../plaid";
import { revalidatePath } from "next/cache";
import { addFundingSource, createDwollaCustomer } from "./dwolla.actions";
import { parse } from "path";
import { IM_Fell_DW_Pica } from "next/font/google";

const { 
    APPWRITE_DATABASE_ID: DATABASE_ID,
    APPWRITE_USER_COLLECTION_ID: USER_COLLECTION_ID,
    APPWRITE_BANK_COLLECTION_ID: BANK_COLLECTION_ID,
} = process.env;

export const signIn = async ({ email, password }: signInProps) => {
    try {
        const { account } = await createAdminClient();

        const response = await account
        .createEmailPasswordSession(email, password);

        return parseStringify(response);
    } catch (error) {
        console.error('Error', error);
    }
}

export const signUp = async ({password, ...userData }: SignUpParams) => {
    const { email, firstName, lastName } = userData;

    let newUserAccount;
    
    try {
        //Create a user account
        const { account, database } = await createAdminClient();

        newUserAccount = await account.create(
            ID.unique(), 
            email, 
            password, 
            `${firstName} ${lastName}`
        );

        //throw error if user failed to be created
        if (!newUserAccount) throw new Error('Error creating user');

        //if user is successfully created, create a
        //dwolla custom url
        const dwollaCustomerUrl = await createDwollaCustomer({
            ...userData,
            type: 'personal'
        });

        //throw error if dwollaCustomerUrl wasn't created
        if (!dwollaCustomerUrl) throw new Error('Error creating Dwolla Customer');

        //if dwolla customer was created, extract the dwolla
        //customer Id
        const dwollaCustomerId = extractCustomerIdFromUrl(dwollaCustomerUrl);

        //add all user details (sign up and dwolla data) to our db
        const newDbUser = await database.createDocument(
            DATABASE_ID!,
            USER_COLLECTION_ID!,
            ID.unique(),
            {
                ...userData,
                userId: newUserAccount.$id,
                dwollaCustomerId,
                dwollaCustomerUrl
            }
        ); 

        //store the user's email and password in the appwrite session
        const session = await account.
        createEmailPasswordSession(email, password);

        //add the session ID to the user browsers cookie when they visit
        //the '/' url
        (await cookies()).set("appwrite-session", session.secret, {
            path: "/",
            httpOnly: true,
            sameSite: "strict",
            secure: true,
        });

        return parseStringify(newDbUser)
    } catch (error) {
        console.error('Error', error);
    }
}

export async function getLoggedInUser() {
    try {
      const { account } = await createSessionClient();

      const user = await account.get();

      return parseStringify(user);
    } catch (error) {
      return null;
    }
}

export const logOutAccount = async () => {
    try {
        const { account } = await createSessionClient();
        (await cookies()).delete('appwrite-session');
        await account.deleteSession('current');
    } catch (error) {
        return null;
    }
}

export const createLinkToken = async (user: User) => {
    try {
        //describe the token parameters
        const tokenParams = {
            user: {
                client_user_id: user.$id,
            },
            client_name: `${user.firstName} ${user.lastName}`,
            products: ['auth'] as Products[],
            language: 'en',
            country_codes: ['US'] as CountryCode[],
        }

        //generate a link token with the specified parameters
        const response = await plaidClient.linkTokenCreate(tokenParams);

        //return the token as an object
        return parseStringify({ linkToken: response.data.link_token })
    } catch (error) {
        console.log(error)
    }
}

//this account is not a dwolla account or plaid account,
//It's an account we create in our db to store details
//of any information we need from the interaction between
//Plaid, Dwolla and our applicatiion
export const createBankAccount = async ({
    userId,
    bankId,
    accountId,
    accessToken,
    fundingSourceUrl,
    sharableId,
}: createBankAccountProps) => {
    try {
        const { database } = await createAdminClient();
        const bankAccount = await database.createDocument(
            DATABASE_ID!,
            BANK_COLLECTION_ID!,
            ID.unique(),
            {
                userId,
                bankId,
                accountId,
                accessToken,
                fundingSourceUrl,
                sharableId,
            }
        )

        return parseStringify(bankAccount);
    } catch (error) {
        
    }
}

export const exchangePublicToken = async ({
    publicToken,
    user,
}: exchangePublicTokenProps) => {
    try {
        //exchange public token for access token and item ID
        const response = await plaidClient.
        itemPublicTokenExchange({
            public_token: publicToken
        });

        //extract the access token and item ID from the response
        const accessToken = response.data.access_token;
        const itemId = response.data.item_id;

        //get accout information from Plaid using the access token
        const accountsResponse = await plaidClient.accountsGet({
            access_token: accessToken,
        });

        //get account data from the accounts Response
        const accountData = accountsResponse.data.accounts[0];

        //create a processor token for Dwolla using the access
        //token and account ID
        const request: ProcessorTokenCreateRequest = {
            access_token: accessToken,
            account_id: accountData.account_id,
            processor: "dwolla" as ProcessorTokenCreateRequestProcessorEnum,
        }

        //generate a processor token from the request
        const processorTokenResponse = await plaidClient.processorTokenCreate(request);
        const processorToken = processorTokenResponse.data.processor_token;

        //Create a funding source URL for the account using
        //Dwolla customer ID, processor token, and bank name.
        //addFundingSource comes from Dwolla
        const fundingSourceUrl = await addFundingSource({
            dwollaCustomerId: user.dwollaCustomerId,
            processorToken,
            bankName: accountData.name,
        })

        //if the funding source URL is not created, throw an error
        if (!fundingSourceUrl) throw Error;

        //if funding source URL exists
        //Create a bank account using the user ID, item ID, account ID,
        //access token, funding source URL, and sharable Id
        await createBankAccount({
            userId: user.$id,
            bankId: itemId,
            accountId: accountData.account_id,
            accessToken,
            fundingSourceUrl,
            sharableId: encryptId(accountData.account_id),
        });

        //Revalidate the path to reflect the new Dwolla Account
        //we have just created
        revalidatePath('/');

        //Return a success message
        return parseStringify({
            publicTokenExhange: "complete",
        })


    } catch (error) {
       console.error("An error occured while creating exchanging token:", error); 
    }
}
