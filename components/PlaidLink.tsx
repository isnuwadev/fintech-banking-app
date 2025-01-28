import React, { useCallback, useEffect, useState } from 'react';
import { Button } from './ui/button';
import Image from 'next/image';
import { PlaidLinkOnSuccess, PlaidLinkOptions, usePlaidLink } from 'react-plaid-link';
import { useRouter } from 'next/navigation';
import { createLinkToken, exchangePublicToken} from '@/lib/actions/user.actions';

const PlaidLink = ({user, variant}: PlaidLinkProps) => {
    const router = useRouter();

    //user to receive link token
    const [token, setToken] = useState('');

    useEffect(() => {
        const getLinkToken = async () => {
            //get link token data after the button has
            //been rendered and finished the process
            //of opening the Link Generation Process
            const data = await createLinkToken(user);

            setToken(data?.linkToken);
        };

        getLinkToken();
    }, [user])

    //On successfull creation of a plaid link for the client
    const onSuccess = useCallback<PlaidLinkOnSuccess>(async (public_token:
        string
    ) => {
        //exchange public token with link token
        await exchangePublicToken({
            publicToken: public_token,
            user,
        })

        //user's public token now gives server access to plaid
        //platform data. Redirect to the '/' route to utilize
        //this data.
        router.push('/'); 

    }, [user]);

    //Plaid link options
    const config: PlaidLinkOptions = {
        token,
        onSuccess
    }

    //use the plaid link hook to start the process
    //of creating a link token
    const { open, ready } = usePlaidLink(config);

  return (
    <>
      {variant === 'primary' ? (
        <Button
        onClick={() => open()}
        disabled={!ready}
        className="plaidlink-primary"
      >
        Connect bank
      </Button>
      ) : variant === 'ghost' ? (
        <Button onClick={() => open()} variant="ghost" className="plaidlink-ghost">
          <Image 
            src="/icons/connect-bank.svg"
            alt="connect bank"
            width={24}
            height={24}
          />
          <p className='hiddenl text-[16px] font-semibold text-black-2 xl:block'>Connect bank</p>
        </Button>
      ) : (
        <Button onClick={() => open()} className="plaidlink-default">
          <Image 
            src="/icons/connect-bank.svg"
            alt="connect bank"
            width={24}
            height={24}
          />
          <p className='text-[16px] font-semibold text-black-2'>Connect bank</p>
        </Button>
      )}
    </>
  )
}

export default PlaidLink
